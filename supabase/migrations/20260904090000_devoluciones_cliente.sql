-- Devoluciones de cliente (docs/arquitectura.md 1.10):
--
--   Buscar venta original -> seleccionar productos
--   -> ¿reingresa al stock o va a merma? (se decide en el momento)
--   -> ¿devolucion de dinero o cambio por otro producto?
--   -> confirmar
--
-- Sin limite de tiempo para devolver (no se valida fecha de la venta a
-- proposito). Bloque 6 dejo el hook en el modelo (ventas.estado='anulada')
-- pero ninguna funcion lo usaba todavia (decision 11 de esa migracion).
--
-- Decisiones de implementacion (no de negocio -- arquitectura.md no las
-- detalla, se documentan explicitamente en vez de dejarlas implicitas):
--
--   1. "Devolucion de dinero" se resuelve siempre en efectivo (mismo
--      espiritu que las promociones: "efectivo = billete en mano" es el
--      unico medio con semantica de caja fisica en este sistema). Afecta
--      la caja ABIERTA HOY en la sucursal de la devolucion -- no la caja
--      del dia de la venta original, que puede estar cerrada hace tiempo.
--      Por eso devolver dinero exige que haya caja abierta hoy, igual que
--      vender (ver supabase/migrations/20260903100000_apertura_caja.sql).
--
--   2. "Cambio por otro producto" es un swap de stock puro: sale el
--      producto nuevo, entra el devuelto (segun destino). No se modela
--      diferencia de precio entre lo devuelto y lo nuevo -- el flujo de
--      1.10 no tiene un paso de "cobrar/pagar diferencia", asi que no se
--      inventa uno. Si hace falta mas adelante, es una decision de negocio
--      a confirmar aparte.
--
--   3. El producto nuevo de un cambio sale con movimientos_stock.tipo
--      'cambio_salida' (nuevo), no 'venta': no genera fila en ventas ni
--      venta_items (no hay pago), asi que etiquetarlo "venta" en el
--      historial de movimientos seria enganoso.
--
--   4. devoluciones/devolucion_items/devolucion_cambio_items quedan
--      bloqueadas contra escritura directa, mismo mecanismo que
--      ventas/venta_items/cajas (bloque 6): solo confirmar_devolucion()
--      escribe.

-- =========================================================
-- Nuevo tipo de movimiento de stock: cambio_salida
-- =========================================================

-- Se busca la constraint por columna en vez de asumir el nombre que le
-- puso Postgres por default (mas seguro que hardcodear
-- "movimientos_stock_tipo_check" y arriesgarse a un DROP que no encuentra
-- nada, o -peor- deja la constraint vieja conviviendo con la nueva).
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
  'desarme_salida', 'desarme_entrada', 'cambio_salida'
));

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
    when 'venta' then -1
    when 'transferencia_salida' then -1
    when 'merma' then -1
    when 'desarme_salida' then -1
    when 'cambio_salida' then -1
    when 'ajuste' then null
    else null
  end;

  if v_signo is null and p_tipo <> 'ajuste' then
    raise exception 'Tipo de movimiento invalido: %', p_tipo;
  end if;

  if p_tipo = 'ajuste' then
    -- unico tipo donde el delta viene firmado: un ajuste puede sumar o
    -- restar segun lo que haya dado el conteo fisico.
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

  -- Garantiza que exista la fila antes de lockearla. on conflict do nothing
  -- para no pisar la cantidad si ya existia.
  insert into stock_sucursal (sku_id, sucursal_id, cantidad)
  values (p_sku_id, p_sucursal_id, 0)
  on conflict (sku_id, sucursal_id) do nothing;

  -- Lockea la fila para que dos movimientos concurrentes sobre el mismo
  -- sku/sucursal no calculen stock_anterior con el mismo valor viejo.
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
-- devoluciones / devolucion_items / devolucion_cambio_items
-- =========================================================

create table devoluciones (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas (id),
  -- Sucursal donde se hace la devolucion: la de la venta original (1.10 no
  -- menciona devoluciones cruzadas entre sucursales).
  sucursal_id uuid not null references sucursales (id),
  usuario_id uuid not null references usuarios (id),
  fecha timestamptz not null default now(),
  resolucion text not null check (resolucion in ('dinero', 'cambio')),
  -- Solo tiene sentido si resolucion = 'dinero' (ver decision 1). Suma de
  -- precio_unitario x cantidad de los items devueltos, al precio
  -- realmente pagado (no el de lista).
  monto_reembolsado numeric(12, 2) check (monto_reembolsado is null or monto_reembolsado >= 0),
  -- Caja de HOY afectada si resolucion = 'dinero'. Null si resolucion =
  -- 'cambio' (no toca caja).
  caja_id uuid references cajas (id),
  observaciones text
);

create index devoluciones_venta_id_idx on devoluciones (venta_id);
create index devoluciones_sucursal_id_idx on devoluciones (sucursal_id);
create index devoluciones_caja_id_idx on devoluciones (caja_id);

create table devolucion_items (
  id uuid primary key default gen_random_uuid(),
  devolucion_id uuid not null references devoluciones (id) on delete cascade,
  venta_item_id uuid not null references venta_items (id),
  cantidad integer not null check (cantidad > 0),
  -- Reingresa a stock vendible, o va a merma (arquitectura.md 1.10: "se
  -- decide en el momento").
  destino text not null check (destino in ('stock', 'merma')),
  -- Precio unitario realmente pagado (venta_items.precio_unitario en el
  -- momento de la venta), congelado aca para no tener que re-derivar
  -- precios historicos al calcular el reembolso.
  precio_unitario numeric(12, 2) not null check (precio_unitario >= 0)
);

create index devolucion_items_devolucion_id_idx on devolucion_items (devolucion_id);
create index devolucion_items_venta_item_id_idx on devolucion_items (venta_item_id);

-- Solo tiene filas si la devolucion es resolucion = 'cambio' (ver decision
-- 2): el/los producto/s que se lleva el cliente en lugar de la plata.
create table devolucion_cambio_items (
  id uuid primary key default gen_random_uuid(),
  devolucion_id uuid not null references devoluciones (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad integer not null check (cantidad > 0)
);

create index devolucion_cambio_items_devolucion_id_idx on devolucion_cambio_items (devolucion_id);

-- =========================================================
-- Bloqueo de escritura directa (mismo mecanismo que ventas/cajas, bloque 6)
-- =========================================================

create or replace function bloquear_escritura_directa_devoluciones()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.devolucion_en_curso', true), 'off') <> 'on' then
    raise exception '% solo se modifica a traves de confirmar_devolucion()', tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger devoluciones_bloquear_escritura_directa
  before insert or update or delete on devoluciones
  for each row
  execute function bloquear_escritura_directa_devoluciones();

create trigger devolucion_items_bloquear_escritura_directa
  before insert or update or delete on devolucion_items
  for each row
  execute function bloquear_escritura_directa_devoluciones();

create trigger devolucion_cambio_items_bloquear_escritura_directa
  before insert or update or delete on devolucion_cambio_items
  for each row
  execute function bloquear_escritura_directa_devoluciones();

-- =========================================================
-- RLS: lectura amplia (usuario_activo(), mismo criterio que ventas/cajas),
-- sin politicas de escritura -- solo confirmar_devolucion() escribe.
-- =========================================================

alter table devoluciones enable row level security;
alter table devolucion_items enable row level security;
alter table devolucion_cambio_items enable row level security;

create policy devoluciones_select on devoluciones for select using (usuario_activo());
create policy devolucion_items_select on devolucion_items for select using (usuario_activo());
create policy devolucion_cambio_items_select on devolucion_cambio_items for select using (usuario_activo());

grant select on devoluciones, devolucion_items, devolucion_cambio_items to authenticated;

-- =========================================================
-- confirmar_devolucion(): registra la devolucion completa en una sola
-- transaccion (items devueltos + movimientos de stock + cambio + caja).
--
-- p_items es un jsonb array: [{venta_item_id, cantidad, destino}]
-- p_cambio_items es un jsonb array (solo si p_resolucion='cambio'):
--   [{sku_id, cantidad}]
-- =========================================================

create or replace function confirmar_devolucion(
  p_venta_id uuid,
  p_items jsonb,
  p_resolucion text,
  p_cambio_items jsonb default null,
  p_observaciones text default null
)
returns devoluciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_caja_id uuid;
  v_devolucion_id uuid;
  v_devolucion devoluciones;
  v_monto_reembolsado numeric(12, 2) := 0;
  v_item record;
  v_venta_item record;
  v_ya_devuelto integer;
  v_cambio record;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  select sucursal_id into v_sucursal_id from ventas where id = p_venta_id;
  if v_sucursal_id is null then
    raise exception 'La venta no existe';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para hacer devoluciones en esta sucursal';
  end if;

  if p_resolucion not in ('dinero', 'cambio') then
    raise exception 'Resolucion invalida: %', p_resolucion;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La devolucion no tiene productos';
  end if;

  if p_resolucion = 'cambio' and (p_cambio_items is null or jsonb_array_length(p_cambio_items) = 0) then
    raise exception 'El cambio necesita al menos un producto de reemplazo';
  end if;

  -- Devolver dinero afecta la caja de HOY en esta sucursal (decision 1),
  -- no la de la venta original. Exige caja abierta, igual que vender.
  if p_resolucion = 'dinero' then
    select id into v_caja_id
    from cajas
    where sucursal_id = v_sucursal_id and fecha = current_date and estado = 'abierta';

    if v_caja_id is null then
      raise exception 'Hace falta abrir la caja de hoy en esta sucursal para devolver dinero';
    end if;
  end if;

  perform set_config('bebidas_moe.devolucion_en_curso', 'on', true);

  insert into devoluciones (venta_id, sucursal_id, usuario_id, resolucion, caja_id, observaciones)
  values (p_venta_id, v_sucursal_id, auth.uid(), p_resolucion, v_caja_id, p_observaciones)
  returning id into v_devolucion_id;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      venta_item_id uuid, cantidad integer, destino text
    )
  loop
    if v_item.venta_item_id is null then
      raise exception 'Falta el item de venta a devolver';
    end if;
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'La cantidad a devolver debe ser mayor a cero';
    end if;
    if v_item.destino not in ('stock', 'merma') then
      raise exception 'Destino invalido: %', v_item.destino;
    end if;

    select sku_id, cantidad, precio_unitario into v_venta_item
    from venta_items
    where id = v_item.venta_item_id and venta_id = p_venta_id;

    if not found then
      raise exception 'El item % no pertenece a la venta indicada', v_item.venta_item_id;
    end if;

    select coalesce(sum(cantidad), 0) into v_ya_devuelto
    from devolucion_items
    where venta_item_id = v_item.venta_item_id;

    if v_ya_devuelto + v_item.cantidad > v_venta_item.cantidad then
      raise exception
        'Se esta devolviendo mas cantidad de la vendida (vendido % , ya devuelto %, intentando devolver %)',
        v_venta_item.cantidad, v_ya_devuelto, v_item.cantidad;
    end if;

    insert into devolucion_items (devolucion_id, venta_item_id, cantidad, destino, precio_unitario)
    values (v_devolucion_id, v_item.venta_item_id, v_item.cantidad, v_item.destino, v_venta_item.precio_unitario);

    perform registrar_movimiento(
      p_sku_id => v_venta_item.sku_id,
      p_sucursal_id => v_sucursal_id,
      p_tipo => 'devolucion_entrada',
      p_cantidad => v_item.cantidad,
      p_documento_tipo => 'devolucion',
      p_documento_id => v_devolucion_id
    );

    if v_item.destino = 'merma' then
      perform registrar_movimiento(
        p_sku_id => v_venta_item.sku_id,
        p_sucursal_id => v_sucursal_id,
        p_tipo => 'merma',
        p_cantidad => v_item.cantidad,
        p_motivo => 'Devuelto por cliente, no reingresa a stock',
        p_documento_tipo => 'devolucion',
        p_documento_id => v_devolucion_id
      );
    end if;

    v_monto_reembolsado := v_monto_reembolsado + v_item.cantidad * v_venta_item.precio_unitario;
  end loop;

  if p_resolucion = 'cambio' then
    for v_cambio in
      select * from jsonb_to_recordset(p_cambio_items) as x(sku_id uuid, cantidad integer)
    loop
      if v_cambio.sku_id is null then
        raise exception 'Falta el SKU de reemplazo del cambio';
      end if;
      if v_cambio.cantidad is null or v_cambio.cantidad <= 0 then
        raise exception 'La cantidad de reemplazo debe ser mayor a cero';
      end if;
      if not exists (select 1 from skus where id = v_cambio.sku_id) then
        raise exception 'El SKU de reemplazo % no existe', v_cambio.sku_id;
      end if;

      insert into devolucion_cambio_items (devolucion_id, sku_id, cantidad)
      values (v_devolucion_id, v_cambio.sku_id, v_cambio.cantidad);

      perform registrar_movimiento(
        p_sku_id => v_cambio.sku_id,
        p_sucursal_id => v_sucursal_id,
        p_tipo => 'cambio_salida',
        p_cantidad => v_cambio.cantidad,
        p_documento_tipo => 'devolucion',
        p_documento_id => v_devolucion_id
      );
    end loop;
  end if;

  update devoluciones
  set monto_reembolsado = case when p_resolucion = 'dinero' then v_monto_reembolsado else null end
  where id = v_devolucion_id
  returning * into v_devolucion;

  perform set_config('bebidas_moe.devolucion_en_curso', 'off', true);

  return v_devolucion;
end;
$$;

comment on column cajas.efectivo_sistema is
  'Efectivo esperado en la caja al cerrar: monto_apertura + ventas en efectivo - devoluciones de dinero del dia (ver cerrar_caja()). Antes de este bloque no existian las devoluciones.';

-- =========================================================
-- cerrar_caja(): el efectivo esperado ahora resta las devoluciones de
-- dinero hechas contra esta caja (decision 1) -- antes de este bloque no
-- existian devoluciones, asi que no se restaba nada.
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
  v_devoluciones_dinero numeric(12, 2);
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

  select coalesce(sum(monto_reembolsado), 0) into v_devoluciones_dinero
  from devoluciones
  where caja_id = p_caja_id and resolucion = 'dinero';

  v_efectivo_sistema := v_monto_apertura + v_ventas_efectivo - v_devoluciones_dinero;

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
