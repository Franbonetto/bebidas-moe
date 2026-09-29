-- Carga inicial: un producto con más de una fecha de vencimiento.
--
-- Pedido del usuario 2026-09-29, contando el depósito: "tengo 2 sidras con
-- diferente fecha de vencimiento, cómo hago". Hasta ahora la pantalla tomaba
-- una sola fecha para toda la cantidad contada, y cargar dos veces el mismo
-- SKU no servía: la segunda carga REEMPLAZA el total (es la decisión de
-- 20260929090000), así que quedaba con la mitad del stock.
--
-- Ahora la cantidad contada se puede repartir en varios lotes, cada uno con
-- su fecha: 6 que vencen en marzo y 6 en septiembre son 12 de stock y dos
-- filas en historial_costos. Eso es exactamente lo que ya pasa cuando la
-- mercadería entra por dos compras distintas -- la carga inicial estaba
-- siendo el único camino que no lo permitía.
--
-- El stock sigue SIN estar atado al lote (CLAUDE.md: "el stock no rastrea de
-- qué lote sale cada unidad"). Los lotes son historial: sirven para saber
-- qué vence y cuándo, no para decidir de cuál sale cada botella que se
-- vende.

begin;

drop function if exists cargar_stock_inicial(uuid, uuid, integer, numeric, date, uuid);
drop function if exists cargar_stock_inicial(uuid, uuid, integer, numeric);

create function cargar_stock_inicial(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad integer,
  p_costo numeric default null,
  p_proveedor_id uuid default null,
  -- [{cantidad, fecha_vencimiento}, ...]. Vacío o null = no se cargó
  -- vencimiento (lo normal en stock viejo del que nadie sabe la fecha).
  p_lotes jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carga_id uuid;
  v_stock_actual integer;
  v_delta integer;
  v_costo_lote numeric(12, 2);
  v_lote jsonb;
  v_suma_lotes integer := 0;
  v_cantidad_lote integer;
  v_fecha_lote date;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para cargar el stock inicial';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para cargar stock en esta sucursal';
  end if;

  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad contada no puede ser negativa';
  end if;

  if p_costo is not null and p_costo < 0 then
    raise exception 'El costo no puede ser negativo';
  end if;

  if not exists (select 1 from skus where id = p_sku_id and activo = true) then
    raise exception 'El producto no existe o está dado de baja';
  end if;

  if p_proveedor_id is not null
    and not exists (select 1 from proveedores where id = p_proveedor_id and activo = true)
  then
    raise exception 'El proveedor no existe o está dado de baja';
  end if;

  -- Los lotes tienen que sumar exactamente lo contado: si no, o falta stock
  -- o sobra, y en cualquiera de los dos casos el número que quedaría
  -- guardado sería mentira.
  if p_lotes is not null and jsonb_array_length(p_lotes) > 0 then
    for v_lote in select * from jsonb_array_elements(p_lotes) loop
      v_cantidad_lote := (v_lote ->> 'cantidad')::integer;
      v_fecha_lote := nullif(v_lote ->> 'fecha_vencimiento', '')::date;

      if v_cantidad_lote is null or v_cantidad_lote <= 0 then
        raise exception 'Cada vencimiento necesita una cantidad mayor a cero';
      end if;
      if v_fecha_lote is null then
        raise exception 'Falta la fecha en uno de los vencimientos';
      end if;

      v_suma_lotes := v_suma_lotes + v_cantidad_lote;
    end loop;

    if v_suma_lotes <> p_cantidad then
      raise exception
        'Los vencimientos suman % y contaste %: tienen que dar igual', v_suma_lotes, p_cantidad;
    end if;
  end if;

  -- El documento de la sucursal se crea la primera vez y se reusa siempre.
  select id into v_carga_id from cargas_iniciales where sucursal_id = p_sucursal_id;
  if v_carga_id is null then
    insert into cargas_iniciales (sucursal_id, iniciada_por)
    values (p_sucursal_id, auth.uid())
    returning id into v_carga_id;
  end if;

  select cantidad into v_stock_actual
  from stock_sucursal
  where sku_id = p_sku_id and sucursal_id = p_sucursal_id;

  v_stock_actual := coalesce(v_stock_actual, 0);
  v_delta := p_cantidad - v_stock_actual;

  if v_delta <> 0 then
    perform registrar_movimiento(
      p_sku_id => p_sku_id,
      p_sucursal_id => p_sucursal_id,
      p_tipo => 'ajuste',
      p_cantidad => v_delta,
      p_motivo => 'Carga inicial de stock',
      p_documento_tipo => 'carga_inicial',
      p_documento_id => v_carga_id
    );
  end if;

  if p_costo is not null then
    update skus set costo_actual = p_costo where id = p_sku_id;
  end if;

  if p_proveedor_id is not null then
    insert into proveedor_skus (proveedor_id, sku_id, costo_referencia, activo)
    values (p_proveedor_id, p_sku_id, p_costo, true)
    on conflict (proveedor_id, sku_id) do update
      set costo_referencia = coalesce(excluded.costo_referencia, proveedor_skus.costo_referencia),
          activo = true;
  end if;

  v_costo_lote := coalesce(p_costo, (select costo_actual from skus where id = p_sku_id));

  perform set_config('bebidas_moe.carga_inicial_en_curso', 'on', true);

  if p_lotes is not null and jsonb_array_length(p_lotes) > 0 then
    -- Una fila por vencimiento declarado.
    for v_lote in select * from jsonb_array_elements(p_lotes) loop
      insert into historial_costos (
        sku_id, proveedor_id, recepcion_id, carga_inicial_id,
        costo_unitario, cantidad, fecha, fecha_vencimiento
      )
      values (
        p_sku_id, p_proveedor_id, null, v_carga_id,
        v_costo_lote, (v_lote ->> 'cantidad')::integer, now(),
        (v_lote ->> 'fecha_vencimiento')::date
      );
    end loop;
  elsif p_cantidad > 0 and v_costo_lote is not null then
    -- Sin vencimientos: el lote se guarda igual si hay costo, para que el
    -- historial de costos del SKU arranque en algún lado.
    insert into historial_costos (
      sku_id, proveedor_id, recepcion_id, carga_inicial_id,
      costo_unitario, cantidad, fecha, fecha_vencimiento
    )
    values (
      p_sku_id, p_proveedor_id, null, v_carga_id,
      v_costo_lote, p_cantidad, now(), null
    );
  end if;

  perform set_config('bebidas_moe.carga_inicial_en_curso', 'off', true);

  return p_cantidad;
end;
$$;

commit;
