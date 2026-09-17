-- Apertura de caja explicita y obligatoria antes de vender (pedido del
-- cliente: "hay que hacer apertura de caja y con cuanto dinero se cuenta
-- al abrir"). Esto REEMPLAZA la decision 6 del bloque 6 ("la caja se abre
-- sola con la primera venta, no hay boton de abrir caja") -- confirmado
-- con el cliente:
--   1. Bloquea vender: sin apertura no se puede confirmar ninguna venta.
--   2. El monto de apertura entra en el calculo de diferencia del cierre
--      y queda guardado con nombre propio (monto_apertura), no mezclado
--      sin identificar dentro de otro numero.
--   3. La abre el encargado de esa sucursal (mismo criterio que ya cierra
--      la caja hoy: opera_sucursal()).

alter table cajas add column if not exists monto_apertura numeric(12, 2);

-- Filas historicas (creadas antes de este bloque, sin apertura registrada
-- porque no existia el concepto): se asumen en 0, no se inventa un monto.
-- Este UPDATE es una escritura directa sobre `cajas`, que esta bloqueada
-- por el trigger cajas_bloquear_escritura_directa (bloque 6) -- hay que
-- prender el mismo flag de sesion que usan las funciones, aunque esto
-- corra una sola vez como parte de la migracion.
select set_config('bebidas_moe.venta_en_curso', 'on', true);
update cajas set monto_apertura = 0 where monto_apertura is null;
select set_config('bebidas_moe.venta_en_curso', 'off', true);

alter table cajas alter column monto_apertura set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cajas_monto_apertura_check') then
    alter table cajas add constraint cajas_monto_apertura_check check (monto_apertura >= 0);
  end if;
end $$;

comment on column cajas.efectivo_sistema is
  'Efectivo esperado en la caja al cerrar: monto_apertura + ventas en efectivo del dia (ver cerrar_caja()). Antes de este bloque era solo ventas en efectivo.';
comment on column cajas.monto_apertura is
  'Monto contado y declarado al abrir la caja (abrir_caja()). Entra en efectivo_sistema/diferencia del cierre.';

-- El mensaje de bloquear_escritura_directa_ventas() nombraba solo
-- confirmar_venta()/cerrar_caja(): se actualiza para incluir abrir_caja(),
-- que ahora tambien escribe cajas legitimamente. La logica del trigger
-- (chequear el flag de sesion) no cambia, solo el texto del error.
create or replace function bloquear_escritura_directa_ventas()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.venta_en_curso', true), 'off') <> 'on' then
    raise exception
      '% solo se modifica a traves de abrir_caja() / confirmar_venta() / cerrar_caja()',
      tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

-- =========================================================
-- abrir_caja(): crea la fila de cajas del dia con el monto contado.
-- Reemplaza el "on conflict do nothing" que hacia confirmar_venta().
-- =========================================================

create or replace function abrir_caja(p_sucursal_id uuid, p_monto_apertura numeric)
returns cajas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja cajas;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para abrir la caja de esta sucursal';
  end if;

  if p_monto_apertura is null or p_monto_apertura < 0 then
    raise exception 'El monto de apertura no puede ser negativo';
  end if;

  if exists (
    select 1 from cajas where sucursal_id = p_sucursal_id and fecha = current_date
  ) then
    raise exception 'La caja de hoy en esta sucursal ya fue abierta';
  end if;

  -- cajas esta bloqueada contra escritura directa (trigger
  -- cajas_bloquear_escritura_directa, bloque 6): hay que prender el mismo
  -- flag de sesion que usan confirmar_venta()/cerrar_caja(), si no el
  -- insert lo rechaza.
  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  insert into cajas (sucursal_id, fecha, monto_apertura, usuario_apertura_id)
  values (p_sucursal_id, current_date, p_monto_apertura, auth.uid())
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;

-- =========================================================
-- confirmar_venta(): ya no abre la caja sola -- exige que abrir_caja() se
-- haya llamado antes. Resto de la funcion sin cambios (ver bloque 6).
-- =========================================================

create or replace function confirmar_venta(
  p_sucursal_id uuid,
  p_medio_pago text,
  p_lineas jsonb
)
returns ventas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja_id uuid;
  v_caja_estado text;
  v_venta ventas;
  v_item record;
  v_subtotal numeric(12, 2) := 0;
  v_descuentos numeric(12, 2) := 0;
  v_deposito numeric(12, 2) := 0;
  v_tipo_envase_id uuid;
  v_valor_deposito numeric(12, 2);
  v_stock_actual integer;
  v_sin_stock boolean;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para vender en esta sucursal';
  end if;

  if p_medio_pago not in ('efectivo', 'debito', 'credito', 'transferencia') then
    raise exception 'Medio de pago invalido: %', p_medio_pago;
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El ticket no tiene productos';
  end if;

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  select id, estado into v_caja_id, v_caja_estado
  from cajas
  where sucursal_id = p_sucursal_id and fecha = current_date;

  if v_caja_id is null then
    raise exception 'Todavia no se abrio la caja de hoy en esta sucursal';
  end if;

  if v_caja_estado <> 'abierta' then
    raise exception 'La caja de hoy en esta sucursal ya esta cerrada';
  end if;

  insert into ventas (sucursal_id, usuario_id, medio_pago, subtotal, total, caja_id)
  values (p_sucursal_id, auth.uid(), p_medio_pago, 0, 0, v_caja_id)
  returning * into v_venta;

  for v_item in
    select * from jsonb_to_recordset(p_lineas) as x(
      sku_id uuid, cantidad integer, precio_unitario numeric,
      precio_lista_unitario numeric, promocion_id uuid, con_envase boolean
    )
  loop
    if v_item.sku_id is null then
      raise exception 'Falta el SKU en alguna linea del ticket';
    end if;
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor a cero';
    end if;
    if v_item.precio_unitario is null or v_item.precio_unitario < 0
       or v_item.precio_lista_unitario is null or v_item.precio_lista_unitario < 0 then
      raise exception 'El precio no puede ser negativo';
    end if;
    if v_item.precio_unitario > v_item.precio_lista_unitario then
      raise exception 'El precio final no puede ser mayor al precio de lista';
    end if;

    -- Regla inviolable: las promociones (combo/cantidad) son solo en
    -- efectivo (arquitectura.md 1.7). No se re-deriva el resto de la
    -- cascada de precios (decision 3), pero esta regla especifica si se
    -- valida acá porque es la unica verdaderamente inviolable del bloque.
    if p_medio_pago <> 'efectivo'
       and (v_item.promocion_id is not null or v_item.precio_unitario <> v_item.precio_lista_unitario) then
      raise exception 'Las promociones y el descuento por efectivo solo aplican pagando en efectivo';
    end if;

    select coalesce(cantidad, 0) into v_stock_actual
    from stock_sucursal
    where sku_id = v_item.sku_id and sucursal_id = p_sucursal_id;

    v_sin_stock := coalesce(v_stock_actual, 0) < v_item.cantidad;

    insert into venta_items (
      venta_id, sku_id, cantidad, precio_unitario, precio_lista_unitario,
      promocion_id, con_envase, vendido_sin_stock
    ) values (
      v_venta.id, v_item.sku_id, v_item.cantidad, v_item.precio_unitario,
      v_item.precio_lista_unitario, v_item.promocion_id,
      coalesce(v_item.con_envase, false), v_sin_stock
    );

    perform registrar_movimiento(
      p_sku_id => v_item.sku_id,
      p_sucursal_id => p_sucursal_id,
      p_tipo => 'venta',
      p_cantidad => v_item.cantidad,
      p_motivo => case when v_sin_stock then 'Venta registrada sin stock suficiente' else null end,
      p_documento_tipo => 'venta',
      p_documento_id => v_venta.id
    );

    v_subtotal := v_subtotal + v_item.precio_lista_unitario * v_item.cantidad;
    v_descuentos := v_descuentos + (v_item.precio_lista_unitario - v_item.precio_unitario) * v_item.cantidad;

    if coalesce(v_item.con_envase, false) then
      select tipo_envase_id into v_tipo_envase_id from skus where id = v_item.sku_id;

      if v_tipo_envase_id is null then
        raise exception 'El SKU % no es retornable, no puede venderse con envase', v_item.sku_id;
      end if;

      select valor_deposito into v_valor_deposito from tipos_envase where id = v_tipo_envase_id;
      v_deposito := v_deposito + coalesce(v_valor_deposito, 0) * v_item.cantidad;

      perform registrar_movimiento_envase(
        p_tipo_envase_id => v_tipo_envase_id,
        p_sucursal_id => p_sucursal_id,
        p_tipo => 'ingreso_cliente',
        p_cantidad => v_item.cantidad,
        p_venta_id => v_venta.id
      );
    end if;
  end loop;

  update ventas set
    subtotal = v_subtotal,
    descuentos = v_descuentos,
    deposito_envases = v_deposito,
    total = v_subtotal - v_descuentos + v_deposito
  where id = v_venta.id
  returning * into v_venta;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_venta;
end;
$$;

-- =========================================================
-- cerrar_caja(): efectivo_sistema ahora es monto_apertura + ventas en
-- efectivo (antes era solo ventas en efectivo, porque no existia apertura).
-- =========================================================

create or replace function cerrar_caja(p_caja_id uuid, p_efectivo_declarado numeric)
returns cajas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_estado text;
  v_monto_apertura numeric(12, 2);
  v_ventas_efectivo numeric(12, 2);
  v_efectivo_sistema numeric(12, 2);
  v_cantidad_tickets integer;
  v_caja cajas;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id, estado, monto_apertura into v_sucursal_id, v_estado, v_monto_apertura
  from cajas where id = p_caja_id
  for update;

  if not found then
    raise exception 'La caja no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para cerrar la caja de esta sucursal';
  end if;

  if v_estado <> 'abierta' then
    raise exception 'Esta caja ya esta cerrada';
  end if;

  if p_efectivo_declarado is null or p_efectivo_declarado < 0 then
    raise exception 'El efectivo declarado no puede ser negativo';
  end if;

  select coalesce(sum(total), 0) into v_ventas_efectivo
  from ventas
  where caja_id = p_caja_id and estado = 'confirmada' and medio_pago = 'efectivo';

  v_efectivo_sistema := v_monto_apertura + v_ventas_efectivo;

  select count(*) into v_cantidad_tickets
  from ventas
  where caja_id = p_caja_id and estado = 'confirmada';

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  update cajas set
    estado = 'cerrada',
    efectivo_sistema = v_efectivo_sistema,
    efectivo_declarado = p_efectivo_declarado,
    diferencia = p_efectivo_declarado - v_efectivo_sistema,
    cantidad_tickets = v_cantidad_tickets,
    usuario_cierre_id = auth.uid(),
    cerrada_en = now()
  where id = p_caja_id
  returning * into v_caja;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_caja;
end;
$$;
