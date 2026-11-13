-- Consignación a clientes (pedido del usuario 2026-11-12): un cliente se
-- lleva mercadería de Olavarría sin pagarla, y a los días vuelve con lo que
-- no vendió. Lo que vendió se cobra en ese momento (venta normal, con sus
-- promos y su factura si corresponde); lo que no vendió reingresa a stock.
-- Es un espejo de prestamos_proveedor (20261031090000) pero con una venta
-- de por medio al liquidar.
--
-- Decisiones del usuario (no están en docs/arquitectura.md, se registran
-- acá):
--   1. El cliente se identifica a mano (nombre, teléfono, nota) -- no se
--      liga a la libreta de clientes (`clientes`), que hoy es solo para
--      facturar y no tiene pantalla de administración.
--   2. La liquidación es un solo evento: el cliente vuelve una vez, dice
--      qué vendió y el resto se devuelve ahí mismo. No hay liquidaciones
--      parciales en varias visitas (a diferencia de los préstamos a
--      proveedor, que sí admiten devolución parcial).
--   3. Solo se origina desde la central (Olavarría), igual que préstamos.
--   4. Permiso: ve_costos() (dueño + encargado de Olavarría) -- mismo
--      criterio que préstamos, es mercadería que sale sin cobrar en el
--      momento.
--   5. Pide PIN_OPERACIONES al entregar y al liquidar (capa app, no acá --
--      ver ajustar_stock_contado() como precedente).
--   6. Lo vendido en la liquidación se cobra como una venta normal: mismas
--      reglas de promoción y descuento por efectivo que cualquier venta de
--      mostrador, y la misma facturación automática si el medio no es
--      efectivo.
--
-- Por qué esto toca confirmar_venta() en vez de armar un camino aparte: la
-- parte vendida de una liquidación necesita precio, promoción, descuento
-- por efectivo y facturación -- exactamente lo que ya calcula
-- confirmar_venta(). Armar una segunda función que lo recalculara se
-- desincroniza con el tiempo (cada cambio futuro de precios habría que
-- hacerlo dos veces). El patrón ya usado en este archivo para cada modo
-- nuevo del POS (envíos, recargo por frío, Mercado Pago) es extender esa
-- misma función con un parámetro más: acá se agrega p_consignacion_id, y
-- cada línea puede traer consignacion_item_id para decir "esta unidad ya
-- había salido del stock al entregarse, no la descuentes de nuevo".
--
-- El caso "no se vendió nada" no entra en confirmar_venta() -- esa función
-- exige al menos una línea y un pago con monto > 0, y acá no hay cobro
-- ninguno. Para eso queda liquidar_consignacion_sin_venta(), que solo
-- devuelve stock y cierra.

begin;

-- =========================================================
-- Nuevos tipos de movimiento: consignacion_salida / consignacion_entrada
-- =========================================================

do $$
declare
  v_tipo_attnum smallint;
  v_conname text;
begin
  select attnum into v_tipo_attnum
  from pg_attribute
  where attrelid = 'movimientos_stock'::regclass and attname = 'tipo';

  select conname into v_conname
  from pg_constraint
  where conrelid = 'movimientos_stock'::regclass
    and contype = 'c'
    and conkey = array[v_tipo_attnum];

  if v_conname is not null then
    execute format('alter table movimientos_stock drop constraint %I', v_conname);
  end if;
end $$;

alter table movimientos_stock add constraint movimientos_stock_tipo_check check (tipo in (
  'compra', 'venta', 'transferencia_salida', 'transferencia_entrada',
  'ajuste', 'merma', 'devolucion_entrada',
  'desarme_salida', 'desarme_entrada', 'cambio_salida',
  'prestamo_salida', 'prestamo_entrada',
  'consignacion_salida', 'consignacion_entrada'
));

-- Redefine registrar_movimiento() solo para sumar los dos tipos nuevos al
-- mapa de signos. El resto del cuerpo es idéntico al de
-- 20261031090000_prestamos_proveedor.sql.
create or replace function registrar_movimiento(
  p_sku_id uuid,
  p_sucursal_id uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo text default null,
  p_documento_tipo text default null,
  p_documento_id uuid default null
)
returns movimientos_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signo integer;
  v_delta integer;
  v_stock_anterior integer;
  v_stock_posterior integer;
  v_movimiento movimientos_stock;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para modificar stock de esta sucursal';
  end if;

  if p_cantidad is null or p_cantidad = 0 then
    raise exception 'La cantidad debe ser distinta de cero';
  end if;

  if not exists (select 1 from skus where id = p_sku_id) then
    raise exception 'El SKU % no existe', p_sku_id;
  end if;

  if not exists (select 1 from sucursales where id = p_sucursal_id) then
    raise exception 'La sucursal % no existe', p_sucursal_id;
  end if;

  v_signo := case p_tipo
    when 'compra' then 1
    when 'transferencia_entrada' then 1
    when 'devolucion_entrada' then 1
    when 'desarme_entrada' then 1
    when 'prestamo_entrada' then 1
    when 'consignacion_entrada' then 1
    when 'venta' then -1
    when 'transferencia_salida' then -1
    when 'merma' then -1
    when 'desarme_salida' then -1
    when 'cambio_salida' then -1
    when 'prestamo_salida' then -1
    when 'consignacion_salida' then -1
    when 'ajuste' then null
    else null
  end;

  if v_signo is null and p_tipo <> 'ajuste' then
    raise exception 'Tipo de movimiento invalido: %', p_tipo;
  end if;

  if p_tipo = 'ajuste' then
    v_delta := p_cantidad;
  else
    if p_cantidad < 0 then
      raise exception
        'Para el tipo % la cantidad se pasa en positivo (magnitud); el signo lo determina el sistema',
        p_tipo;
    end if;
    v_delta := v_signo * p_cantidad;
  end if;

  perform set_config('bebidas_moe.movimiento_en_curso', 'on', true);

  insert into stock_sucursal (sku_id, sucursal_id, cantidad)
  values (p_sku_id, p_sucursal_id, 0)
  on conflict (sku_id, sucursal_id) do nothing;

  select cantidad into v_stock_anterior
  from stock_sucursal
  where sku_id = p_sku_id and sucursal_id = p_sucursal_id
  for update;

  v_stock_posterior := v_stock_anterior + v_delta;

  update stock_sucursal
  set cantidad = v_stock_posterior
  where sku_id = p_sku_id and sucursal_id = p_sucursal_id;

  insert into movimientos_stock (
    sku_id, sucursal_id, tipo, cantidad, stock_anterior, stock_posterior,
    usuario_id, motivo, documento_tipo, documento_id
  ) values (
    p_sku_id, p_sucursal_id, p_tipo, v_delta, v_stock_anterior, v_stock_posterior,
    auth.uid(), p_motivo, p_documento_tipo, p_documento_id
  )
  returning * into v_movimiento;

  perform set_config('bebidas_moe.movimiento_en_curso', 'off', true);

  return v_movimiento;
end;
$$;

-- =========================================================
-- consignaciones / consignacion_items
-- =========================================================

create table consignaciones (
  id uuid primary key default gen_random_uuid(),
  -- Siempre la central (decision 3): la fija registrar_consignacion()
  -- segun sucursales.es_central, no la elige quien la entrega.
  sucursal_id uuid not null references sucursales (id),
  usuario_id uuid not null references usuarios (id),
  -- El cliente se anota a mano (decision 1), no hay tabla de clientes para
  -- esto.
  cliente_nombre text not null,
  cliente_telefono text,
  nota text,
  fecha_entrega timestamptz not null default now(),
  fecha_estimada_devolucion date,
  estado text not null default 'activa' check (estado in ('activa', 'liquidada')),
  usuario_liquidacion_id uuid references usuarios (id),
  fecha_liquidacion timestamptz,
  -- La venta que generó la liquidación, si se vendió algo (decision 2: un
  -- solo evento, así que a lo sumo hay una). Null si se devolvió todo sin
  -- vender nada -- ver liquidar_consignacion_sin_venta().
  venta_id uuid references ventas (id)
);

create index consignaciones_sucursal_id_idx on consignaciones (sucursal_id);
create index consignaciones_estado_idx on consignaciones (estado);

create table consignacion_items (
  id uuid primary key default gen_random_uuid(),
  consignacion_id uuid not null references consignaciones (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad_entregada integer not null check (cantidad_entregada > 0),
  -- Se van completando al liquidar (un solo evento: al final de la
  -- liquidación, vendida + devuelta == entregada para cada item). Antes de
  -- liquidar quedan las dos en 0.
  cantidad_vendida integer not null default 0 check (cantidad_vendida >= 0),
  cantidad_devuelta integer not null default 0 check (cantidad_devuelta >= 0),
  check (cantidad_vendida + cantidad_devuelta <= cantidad_entregada)
);

create index consignacion_items_consignacion_id_idx on consignacion_items (consignacion_id);
create index consignacion_items_sku_id_idx on consignacion_items (sku_id);

-- Trazabilidad: desde una venta se puede ver qué línea liquidó qué item de
-- qué consignación, y viceversa.
alter table venta_items add column consignacion_item_id uuid references consignacion_items (id);
create index venta_items_consignacion_item_id_idx on venta_items (consignacion_item_id);

-- =========================================================
-- Bloqueo de escritura directa. A diferencia de prestamos_proveedor, acá
-- hay DOS caminos legítimos de escritura: las funciones propias de
-- consignación (entrega, devolución sin venta) Y confirmar_venta() cuando
-- la liquidación vende algo -- por eso el trigger acepta cualquiera de las
-- dos banderas de "operación en curso".
-- =========================================================

create or replace function bloquear_escritura_directa_consignaciones()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.consignacion_en_curso', true), 'off') <> 'on'
     and coalesce(current_setting('bebidas_moe.venta_en_curso', true), 'off') <> 'on' then
    raise exception
      '% solo se modifica a traves de registrar_consignacion(), confirmar_venta() o liquidar_consignacion_sin_venta()',
      tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger consignaciones_bloquear_escritura_directa
  before insert or update or delete on consignaciones
  for each row
  execute function bloquear_escritura_directa_consignaciones();

create trigger consignacion_items_bloquear_escritura_directa
  before insert or update or delete on consignacion_items
  for each row
  execute function bloquear_escritura_directa_consignaciones();

-- =========================================================
-- RLS: ve_costos() (decision 4), igual que prestamos_proveedor.
-- =========================================================

alter table consignaciones enable row level security;
alter table consignacion_items enable row level security;

create policy consignaciones_select on consignaciones for select using (ve_costos());
create policy consignacion_items_select on consignacion_items for select using (ve_costos());

grant select on consignaciones, consignacion_items to authenticated;

-- =========================================================
-- registrar_consignacion(): crea la consignacion y descuenta stock de cada
-- sku, todo en una transaccion. p_items es un jsonb array:
-- [{sku_id, cantidad}]
-- =========================================================

create or replace function registrar_consignacion(
  p_cliente_nombre text,
  p_cliente_telefono text,
  p_nota text,
  p_items jsonb,
  p_fecha_estimada_devolucion date default null
)
returns consignaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_consignacion_id uuid;
  v_consignacion consignaciones;
  v_item record;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para entregar mercaderia en consignacion';
  end if;

  if coalesce(trim(p_cliente_nombre), '') = '' then
    raise exception 'Falta el nombre del cliente';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La consignacion no tiene productos';
  end if;

  select id into v_sucursal_id from sucursales where es_central = true;
  if v_sucursal_id is null then
    raise exception 'No se encontro la sucursal central';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para entregar consignaciones desde esta sucursal';
  end if;

  perform set_config('bebidas_moe.consignacion_en_curso', 'on', true);

  insert into consignaciones (
    sucursal_id, usuario_id, cliente_nombre, cliente_telefono, nota, fecha_estimada_devolucion
  ) values (
    v_sucursal_id, auth.uid(), trim(p_cliente_nombre),
    nullif(trim(coalesce(p_cliente_telefono, '')), ''),
    nullif(trim(coalesce(p_nota, '')), ''),
    p_fecha_estimada_devolucion
  )
  returning id into v_consignacion_id;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(sku_id uuid, cantidad integer)
  loop
    if v_item.sku_id is null then
      raise exception 'Falta el SKU de la consignacion';
    end if;
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'La cantidad entregada debe ser mayor a cero';
    end if;
    if not exists (select 1 from skus where id = v_item.sku_id) then
      raise exception 'El SKU % no existe', v_item.sku_id;
    end if;

    insert into consignacion_items (consignacion_id, sku_id, cantidad_entregada)
    values (v_consignacion_id, v_item.sku_id, v_item.cantidad);

    perform registrar_movimiento(
      p_sku_id => v_item.sku_id,
      p_sucursal_id => v_sucursal_id,
      p_tipo => 'consignacion_salida',
      p_cantidad => v_item.cantidad,
      p_motivo => 'Entrega en consignacion',
      p_documento_tipo => 'consignacion',
      p_documento_id => v_consignacion_id
    );
  end loop;

  select * into v_consignacion from consignaciones where id = v_consignacion_id;

  perform set_config('bebidas_moe.consignacion_en_curso', 'off', true);

  return v_consignacion;
end;
$$;

-- =========================================================
-- liquidar_consignacion_sin_venta(): el cliente no vendio nada, devuelve
-- todo. No hay cobro, asi que no pasa por confirmar_venta().
-- =========================================================

create or replace function liquidar_consignacion_sin_venta(
  p_consignacion_id uuid
)
returns consignaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consignacion consignaciones;
  v_item record;
  v_pendiente integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para liquidar consignaciones';
  end if;

  select * into v_consignacion from consignaciones where id = p_consignacion_id for update;
  if not found then
    raise exception 'La consignacion no existe';
  end if;

  if v_consignacion.estado <> 'activa' then
    raise exception 'Esta consignacion ya esta liquidada';
  end if;

  if not opera_sucursal(v_consignacion.sucursal_id) then
    raise exception 'No tenes permiso para liquidar esta consignacion';
  end if;

  perform set_config('bebidas_moe.consignacion_en_curso', 'on', true);

  for v_item in
    select * from consignacion_items where consignacion_id = p_consignacion_id for update
  loop
    v_pendiente := v_item.cantidad_entregada - v_item.cantidad_vendida - v_item.cantidad_devuelta;
    if v_pendiente > 0 then
      perform registrar_movimiento(
        p_sku_id => v_item.sku_id,
        p_sucursal_id => v_consignacion.sucursal_id,
        p_tipo => 'consignacion_entrada',
        p_cantidad => v_pendiente,
        p_motivo => 'Devolucion total de consignacion, nada vendido',
        p_documento_tipo => 'consignacion',
        p_documento_id => p_consignacion_id
      );

      update consignacion_items
      set cantidad_devuelta = cantidad_devuelta + v_pendiente
      where id = v_item.id;
    end if;
  end loop;

  update consignaciones
  set estado = 'liquidada', usuario_liquidacion_id = auth.uid(), fecha_liquidacion = now()
  where id = p_consignacion_id
  returning * into v_consignacion;

  perform set_config('bebidas_moe.consignacion_en_curso', 'off', true);

  return v_consignacion;
end;
$$;

-- =========================================================
-- confirmar_venta(): mismo cuerpo que
-- 20261028090000_mercadopago_cuentadni.sql, con un parametro mas
-- (p_consignacion_id) y un campo mas por linea (consignacion_item_id).
--
-- Si una linea trae consignacion_item_id: no se descuenta stock de nuevo
-- (ya salio al entregarse en consignacion), pero el resto -- precio,
-- promocion, descuento por efectivo, insert en venta_items -- funciona
-- igual que cualquier linea. Al final, si p_consignacion_id no es null, se
-- devuelve a stock lo que haya quedado pendiente de cada item de esa
-- consignacion (lo que la cajera no marco como vendido) y se cierra la
-- consignacion -- siempre en la misma transaccion que la venta.
-- =========================================================

drop function if exists confirmar_venta(uuid, jsonb, jsonb, boolean, text, text, boolean, uuid);

create or replace function confirmar_venta(
  p_sucursal_id uuid,
  p_pagos jsonb,
  p_lineas jsonb,
  p_es_envio boolean default false,
  p_motomandado text default null,
  p_direccion_envio text default null,
  p_envio_pagado boolean default null,
  p_idempotency_key uuid default null,
  -- Consignacion que se esta liquidando, si corresponde (ver arriba). Null
  -- en una venta de mostrador normal, que no cambia en nada.
  p_consignacion_id uuid default null
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
  v_pago record;
  v_subtotal numeric(12, 2) := 0;
  v_descuentos numeric(12, 2) := 0;
  v_deposito numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_suma_pagos numeric(12, 2) := 0;
  v_cantidad_pagos integer;
  v_es_efectivo_puro boolean;
  v_medio_pago_venta text;
  v_tipo_envase_id uuid;
  v_valor_deposito numeric(12, 2);
  v_stock_actual integer;
  v_sin_stock boolean;
  v_descripcion text;
  v_recargo numeric(12, 2);
  v_editado boolean;
  v_toca_precio boolean;
  v_puede_tocar_precios boolean;
  v_consignacion consignaciones;
  v_consignacion_item consignacion_items;
  v_consig_item record;
  v_pendiente_consignacion integer;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not opera_sucursal(p_sucursal_id) then
    raise exception 'No tenes permiso para vender en esta sucursal';
  end if;

  if p_idempotency_key is not null then
    select * into v_venta from ventas where idempotency_key = p_idempotency_key;
    if found then
      return v_venta;
    end if;
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El ticket no tiene productos';
  end if;

  if p_es_envio and (coalesce(trim(p_motomandado), '') = '' or coalesce(trim(p_direccion_envio), '') = '') then
    raise exception 'Un envio necesita motomandado y direccion';
  end if;

  if p_es_envio and p_envio_pagado is null then
    raise exception 'Un envio necesita saber si el pedido ya esta pago';
  end if;

  -- ---------------------------------------------------------------
  -- Liquidacion de consignacion: permiso y estado se validan antes de
  -- tocar nada (decision del usuario: dueño + encargado de Olavarria,
  -- igual que entregarla).
  -- ---------------------------------------------------------------
  if p_consignacion_id is not null then
    if not ve_costos() then
      raise exception 'No tenes permiso para liquidar consignaciones';
    end if;

    select * into v_consignacion from consignaciones where id = p_consignacion_id for update;
    if not found then
      raise exception 'La consignacion no existe';
    end if;

    if v_consignacion.estado <> 'activa' then
      raise exception 'Esta consignacion ya esta liquidada';
    end if;

    if v_consignacion.sucursal_id <> p_sucursal_id then
      raise exception 'Esta consignacion no corresponde a esta sucursal';
    end if;
  end if;

  v_cantidad_pagos := coalesce(jsonb_array_length(p_pagos), 0);
  if v_cantidad_pagos < 1 or v_cantidad_pagos > 3 then
    raise exception 'La venta tiene que tener entre 1 y 3 medios de pago';
  end if;

  for v_pago in select * from jsonb_to_recordset(p_pagos) as x(medio_pago text, monto numeric)
  loop
    if v_pago.medio_pago not in ('efectivo', 'debito', 'credito', 'transferencia', 'qr', 'mercado_pago', 'cuenta_dni') then
      raise exception 'Medio de pago invalido: %', v_pago.medio_pago;
    end if;
    if v_pago.monto is null or v_pago.monto <= 0 then
      raise exception 'El monto de cada medio de pago tiene que ser mayor a cero';
    end if;
    v_suma_pagos := v_suma_pagos + v_pago.monto;
  end loop;

  v_es_efectivo_puro := v_cantidad_pagos = 1 and (p_pagos->0->>'medio_pago') = 'efectivo';
  v_medio_pago_venta := case when v_cantidad_pagos = 1 then p_pagos->0->>'medio_pago' else 'mixto' end;

  v_puede_tocar_precios := ve_costos();

  perform set_config('bebidas_moe.venta_en_curso', 'on', true);

  select id, estado into v_caja_id, v_caja_estado
  from cajas
  where sucursal_id = p_sucursal_id and fecha = fecha_operativa();

  if v_caja_id is null then
    raise exception 'Todavia no se abrio la caja de hoy en esta sucursal';
  end if;

  if v_caja_estado <> 'abierta' then
    raise exception 'La caja de hoy en esta sucursal ya esta cerrada';
  end if;

  begin
    insert into ventas (
      sucursal_id, usuario_id, medio_pago, subtotal, total, caja_id,
      es_envio, motomandado, direccion_envio, envio_pagado, idempotency_key
    )
    values (
      p_sucursal_id, auth.uid(), v_medio_pago_venta, 0, 0, v_caja_id,
      p_es_envio, nullif(trim(p_motomandado), ''), nullif(trim(p_direccion_envio), ''),
      case when p_es_envio then p_envio_pagado else null end,
      p_idempotency_key
    )
    returning * into v_venta;
  exception when unique_violation then
    select * into v_venta from ventas where idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    perform set_config('bebidas_moe.venta_en_curso', 'off', true);
    return v_venta;
  end;

  for v_item in
    select * from jsonb_to_recordset(p_lineas) as x(
      sku_id uuid, descripcion text, cantidad integer, precio_unitario numeric,
      precio_lista_unitario numeric, promocion_id uuid, con_envase boolean,
      recargo_frio numeric, precio_editado boolean, precio_catalogo numeric,
      consignacion_item_id uuid
    )
  loop
    v_descripcion := nullif(trim(coalesce(v_item.descripcion, '')), '');
    v_recargo := coalesce(v_item.recargo_frio, 0);
    v_editado := coalesce(v_item.precio_editado, false);
    v_toca_precio := v_recargo > 0 or v_editado;

    if v_item.sku_id is null and v_descripcion is null then
      raise exception 'Una linea del ticket no tiene ni SKU ni descripcion';
    end if;
    if v_item.sku_id is not null and v_descripcion is not null then
      raise exception 'Una linea del ticket tiene SKU y descripcion a la vez';
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

    -- ---------------------------------------------------------------
    -- Linea que liquida un item de consignacion: valida que exista, que
    -- sea de ESTA consignacion y que no se este vendiendo mas de lo
    -- pendiente. El lock (for update) evita que dos liquidaciones
    -- concurrentes del mismo item se pisen.
    -- ---------------------------------------------------------------
    if v_item.consignacion_item_id is not null then
      if p_consignacion_id is null then
        raise exception 'Una linea de consignacion necesita indicar la consignacion';
      end if;
      if v_item.sku_id is null then
        raise exception 'Un producto particular no puede venir de una consignacion';
      end if;

      select * into v_consignacion_item
      from consignacion_items
      where id = v_item.consignacion_item_id and consignacion_id = p_consignacion_id
      for update;

      if not found then
        raise exception 'El item de consignacion % no corresponde a esta consignacion', v_item.consignacion_item_id;
      end if;

      if v_consignacion_item.sku_id <> v_item.sku_id then
        raise exception 'El SKU de la linea no coincide con el item de consignacion';
      end if;

      v_pendiente_consignacion := v_consignacion_item.cantidad_entregada
        - v_consignacion_item.cantidad_vendida - v_consignacion_item.cantidad_devuelta;

      if v_item.cantidad > v_pendiente_consignacion then
        raise exception
          'Se esta vendiendo mas de lo pendiente de esta consignacion (pendiente %, intentando vender %)',
          v_pendiente_consignacion, v_item.cantidad;
      end if;
    end if;

    if v_toca_precio then
      if not v_puede_tocar_precios then
        raise exception 'No tenes permiso para tocar precios en el punto de venta';
      end if;
      if v_item.sku_id is null then
        raise exception 'Un producto particular no lleva recargo ni precio editado: su precio ya se carga a mano';
      end if;
      if v_item.promocion_id is not null then
        raise exception 'Una linea con promocion no se puede editar: el precio de la promo lo reparte el sistema';
      end if;
      if v_editado and v_item.precio_unitario <> v_item.precio_lista_unitario then
        raise exception 'Un precio tocado a mano no lleva descuento: el precio que se carga es el final';
      end if;
      if v_recargo > v_item.precio_unitario then
        raise exception 'El recargo por frio no puede ser mayor al precio que se cobra';
      end if;
    end if;

    if v_recargo < 0 then
      raise exception 'El recargo por frio no puede ser negativo';
    end if;

    if not v_es_efectivo_puro
       and (v_item.promocion_id is not null or v_item.precio_unitario <> v_item.precio_lista_unitario) then
      raise exception 'Las promociones y el descuento por efectivo solo aplican pagando 100%% en efectivo';
    end if;

    if v_item.sku_id is null then
      if v_item.promocion_id is not null then
        raise exception 'Un producto particular no puede tener promocion';
      end if;
      if coalesce(v_item.con_envase, false) then
        raise exception 'Un producto particular no puede llevar envase retornable';
      end if;
      if v_item.precio_unitario <> v_item.precio_lista_unitario then
        raise exception 'Un producto particular no lleva descuento: el precio que se carga es el final';
      end if;

      insert into venta_items (
        venta_id, sku_id, descripcion, cantidad, precio_unitario,
        precio_lista_unitario, promocion_id, con_envase, vendido_sin_stock
      ) values (
        v_venta.id, null, v_descripcion, v_item.cantidad, v_item.precio_unitario,
        v_item.precio_lista_unitario, null, false, false
      );

      v_subtotal := v_subtotal + v_item.precio_lista_unitario * v_item.cantidad;

      continue;
    end if;

    if v_item.consignacion_item_id is null then
      select coalesce(cantidad, 0) into v_stock_actual
      from stock_sucursal
      where sku_id = v_item.sku_id and sucursal_id = p_sucursal_id;

      v_sin_stock := coalesce(v_stock_actual, 0) < v_item.cantidad;
    else
      -- Ya salio del stock al entregarse en consignacion: no hay nada que
      -- chequear acá.
      v_sin_stock := false;
    end if;

    insert into venta_items (
      venta_id, sku_id, cantidad, precio_unitario, precio_lista_unitario,
      promocion_id, con_envase, vendido_sin_stock,
      recargo_frio, precio_editado, precio_catalogo, consignacion_item_id
    ) values (
      v_venta.id, v_item.sku_id, v_item.cantidad, v_item.precio_unitario,
      v_item.precio_lista_unitario, v_item.promocion_id,
      coalesce(v_item.con_envase, false), v_sin_stock,
      v_recargo, v_editado, case when v_editado then v_item.precio_catalogo end,
      v_item.consignacion_item_id
    );

    if v_item.consignacion_item_id is null then
      perform registrar_movimiento(
        p_sku_id => v_item.sku_id,
        p_sucursal_id => p_sucursal_id,
        p_tipo => 'venta',
        p_cantidad => v_item.cantidad,
        p_motivo => case when v_sin_stock then 'Venta registrada sin stock suficiente' else null end,
        p_documento_tipo => 'venta',
        p_documento_id => v_venta.id
      );
    else
      update consignacion_items
      set cantidad_vendida = cantidad_vendida + v_item.cantidad
      where id = v_item.consignacion_item_id;
    end if;

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

  v_total := v_subtotal - v_descuentos + v_deposito;

  if abs(v_suma_pagos - v_total) > 0.01 then
    raise exception 'La suma de los medios de pago ($%) no coincide con el total de la venta ($%)', v_suma_pagos, v_total;
  end if;

  update ventas set
    subtotal = v_subtotal,
    descuentos = v_descuentos,
    deposito_envases = v_deposito,
    total = v_total
  where id = v_venta.id
  returning * into v_venta;

  insert into venta_pagos (venta_id, medio_pago, monto)
  select v_venta.id, x.medio_pago, x.monto
  from jsonb_to_recordset(p_pagos) as x(medio_pago text, monto numeric);

  -- ---------------------------------------------------------------
  -- Cierre de la consignacion (decision del usuario: un solo evento). Lo
  -- que haya quedado pendiente en cada item -- lo que la cajera no marco
  -- como vendido -- vuelve a stock aca mismo, y la consignacion se cierra.
  -- ---------------------------------------------------------------
  if p_consignacion_id is not null then
    for v_consig_item in
      select * from consignacion_items where consignacion_id = p_consignacion_id for update
    loop
      v_pendiente_consignacion := v_consig_item.cantidad_entregada
        - v_consig_item.cantidad_vendida - v_consig_item.cantidad_devuelta;

      if v_pendiente_consignacion > 0 then
        perform registrar_movimiento(
          p_sku_id => v_consig_item.sku_id,
          p_sucursal_id => p_sucursal_id,
          p_tipo => 'consignacion_entrada',
          p_cantidad => v_pendiente_consignacion,
          p_motivo => 'Devolucion de consignacion no vendida',
          p_documento_tipo => 'consignacion',
          p_documento_id => p_consignacion_id
        );

        update consignacion_items
        set cantidad_devuelta = cantidad_devuelta + v_pendiente_consignacion
        where id = v_consig_item.id;
      end if;
    end loop;

    update consignaciones
    set estado = 'liquidada', usuario_liquidacion_id = auth.uid(), fecha_liquidacion = now(), venta_id = v_venta.id
    where id = p_consignacion_id;
  end if;

  perform set_config('bebidas_moe.venta_en_curso', 'off', true);

  return v_venta;
end;
$$;

commit;
