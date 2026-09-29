-- Carga inicial: vencimiento y proveedor por producto.
--
-- Pedido del usuario 2026-09-28, contando el stock inicial: necesita anotar
-- la fecha de vencimiento de lo que está contando (hay mercadería vieja en
-- el depósito) y de paso dejar asentado a qué proveedor le compra cada
-- producto.
--
-- Dónde va cada dato, y por qué:
--
--   - VENCIMIENTO -> historial_costos.fecha_vencimiento. Es el único lugar
--     que miran los tres paneles de Inicio para "Próximos vencimientos"
--     (dashboard/lib.ts, calcularProductosPorVencer: último lote por SKU).
--     Guardarlo en otro lado sería guardarlo donde nadie lo lee.
--   - PROVEEDOR -> proveedor_skus, que ya existe desde el bloque 4 y es lo
--     que alimenta el costo de referencia al cargar mercadería, la
--     sugerencia de pedido de compra agrupada por proveedor, y la alerta de
--     "SKU sin proveedor activo". Es exactamente la tabla para esto.
--
-- Eso obliga a que historial_costos acepte un lote que NO viene de una
-- recepción de compra. Las tres columnas que se relajan
-- (recepcion_id, proveedor_id, costo_unitario) siguen siendo obligatorias
-- para los lotes de recepción -- se agregan checks que lo garantizan, así
-- que ninguna compra puede grabar un lote incompleto por este cambio.
--
-- El costo puede faltar a propósito: es stock viejo del que el dueño no se
-- acuerda cuánto pagó. Se guarda NULL en vez de cero porque un cero rompe el
-- cálculo de "costos que subieron" (divide por el costo anterior: con cero
-- da infinito y le llena el panel de alertas falsas en la primera compra
-- real).

begin;

-- =========================================================
-- historial_costos: aceptar lotes de carga inicial
-- =========================================================

alter table historial_costos add column carga_inicial_id uuid references cargas_iniciales (id);

alter table historial_costos alter column recepcion_id drop not null;
alter table historial_costos alter column proveedor_id drop not null;
alter table historial_costos alter column costo_unitario drop not null;

-- Un lote viene de una recepción o de una carga inicial, nunca de las dos
-- ni de ninguna.
alter table historial_costos add constraint historial_costos_origen_unico check (
  (recepcion_id is not null) <> (carga_inicial_id is not null)
);

-- Lo que se relajó arriba vale SOLO para la carga inicial: un lote de
-- recepción sigue exigiendo proveedor y costo, como desde el bloque 4.
alter table historial_costos add constraint historial_costos_recepcion_completa check (
  recepcion_id is null or (proveedor_id is not null and costo_unitario is not null)
);

create index historial_costos_carga_inicial_id_idx
  on historial_costos (carga_inicial_id);

-- El trigger de escritura directa ahora también deja pasar la carga inicial.
-- Sigue siendo inmutable: nada de UPDATE ni DELETE, nunca.

create or replace function bloquear_escritura_directa_historial_costos()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception
      'historial_costos es inmutable: una fila por lote recibido, nunca se sobrescribe';
  end if;

  if coalesce(current_setting('bebidas_moe.recepcion_en_curso', true), 'off') <> 'on'
    and coalesce(current_setting('bebidas_moe.carga_inicial_en_curso', true), 'off') <> 'on'
  then
    raise exception
      'historial_costos solo se inserta al confirmar una recepcion o al cargar el stock inicial';
  end if;

  return coalesce(new, old);
end;
$$;

-- =========================================================
-- cargar_stock_inicial(): + vencimiento y proveedor
-- =========================================================
-- Se dropea la versión de 4 argumentos por lo mismo que en
-- cargar_compra_directa(): dos funciones con el mismo nombre y defaults
-- dejan a PostgREST sin poder resolver cuál llamar.

drop function if exists cargar_stock_inicial(uuid, uuid, integer, numeric);

create function cargar_stock_inicial(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_cantidad integer,
  p_costo numeric default null,
  p_fecha_vencimiento date default null,
  p_proveedor_id uuid default null
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

  -- Sin diferencia no hay movimiento: recargar el mismo número dos veces no
  -- ensucia el historial de stock.
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

  -- Proveedor habitual del producto. Si ya estaba cargado se actualiza el
  -- costo de referencia y se reactiva; no se borra ningún otro proveedor
  -- del mismo SKU (proveedor_skus admite varios, arquitectura.md 1.6).
  if p_proveedor_id is not null then
    insert into proveedor_skus (proveedor_id, sku_id, costo_referencia, activo)
    values (p_proveedor_id, p_sku_id, p_costo, true)
    on conflict (proveedor_id, sku_id) do update
      set costo_referencia = coalesce(excluded.costo_referencia, proveedor_skus.costo_referencia),
          activo = true;
  end if;

  -- El lote: solo tiene sentido si hay algo que guardar (un costo o un
  -- vencimiento) y si efectivamente hay unidades. Una recarga posterior del
  -- mismo SKU inserta otro lote -- historial_costos es inmutable, no se
  -- corrige hacia atrás; el panel de vencimientos mira el último por SKU,
  -- así que el número que vale es siempre el del conteo más reciente.
  v_costo_lote := coalesce(p_costo, (select costo_actual from skus where id = p_sku_id));

  if p_cantidad > 0 and (v_costo_lote is not null or p_fecha_vencimiento is not null) then
    perform set_config('bebidas_moe.carga_inicial_en_curso', 'on', true);

    insert into historial_costos (
      sku_id, proveedor_id, recepcion_id, carga_inicial_id,
      costo_unitario, cantidad, fecha, fecha_vencimiento
    )
    values (
      p_sku_id, p_proveedor_id, null, v_carga_id,
      v_costo_lote, p_cantidad, now(), p_fecha_vencimiento
    );

    perform set_config('bebidas_moe.carga_inicial_en_curso', 'off', true);
  end if;

  return p_cantidad;
end;
$$;

commit;
