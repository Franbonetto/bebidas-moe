-- Préstamos de mercadería a proveedores: un proveedor pide prestado algo
-- (ej. 2 cajas de vino) y lo devuelve a los días. No es una venta -- no
-- cobra, no toca caja, no se factura -- pero igual que una venta hace
-- bajar stock real de la sucursal, así que necesita la misma trazabilidad
-- que cualquier otro movimiento (CLAUDE.md regla 1).
--
-- Decisiones del usuario (no están en docs/arquitectura.md, se registran
-- acá):
--   1. Solo se origina desde la sucursal central (Olavarría): es la que
--      tiene la relación con proveedores, igual que compras.
--   2. La devolución puede ser parcial: el proveedor puede traer de a
--      partes. El préstamo sigue "activo" hasta que no quede nada
--      pendiente en ningún ítem.
--   3. Permiso: igual que costos y proveedores -- ve_costos() (dueño +
--      encargado de Olavarría). Laprida no opera esto.
--   4. Pide PIN_OPERACIONES al confirmar y al reintegrar (lib/pin.ts, en la
--      capa de la app) -- no acá: la validación de PIN nunca vive en SQL,
--      ver ajustar_stock_contado() como precedente.
--   5. Fecha estimada de devolución: campo opcional, para que el panel del
--      dueño pueda marcar "atrasado" sin tener que adivinar a ojo.

-- =========================================================
-- Nuevos tipos de movimiento de stock: prestamo_salida / prestamo_entrada
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
  'prestamo_salida', 'prestamo_entrada'
));

-- Redefine registrar_movimiento() solo para sumar los dos tipos nuevos al
-- mapa de signos. El resto del cuerpo es idéntico al de
-- 20260904090000_devoluciones_cliente.sql.
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
    when 'venta' then -1
    when 'transferencia_salida' then -1
    when 'merma' then -1
    when 'desarme_salida' then -1
    when 'cambio_salida' then -1
    when 'prestamo_salida' then -1
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
-- prestamos_proveedor / prestamo_items
-- =========================================================

create table prestamos_proveedor (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references proveedores (id),
  -- Siempre la central (decision 1): no la elige quien registra el
  -- prestamo, la fija registrar_prestamo_proveedor() segun
  -- sucursales.es_central.
  sucursal_id uuid not null references sucursales (id),
  usuario_id uuid not null references usuarios (id),
  fecha_prestamo timestamptz not null default now(),
  -- Opcional (decision 5): si se completa, el panel del dueño puede
  -- marcar atrasado lo que paso esa fecha y sigue 'activo'.
  fecha_estimada_devolucion date,
  nota text,
  estado text not null default 'activo' check (estado in ('activo', 'devuelto')),
  usuario_devolucion_id uuid references usuarios (id),
  -- Fecha del ULTIMO reintegro que cerro el prestamo (si hubo devoluciones
  -- parciales antes, esas quedan en movimientos_stock con su propia fecha).
  fecha_devolucion timestamptz
);

create index prestamos_proveedor_proveedor_id_idx on prestamos_proveedor (proveedor_id);
create index prestamos_proveedor_sucursal_id_idx on prestamos_proveedor (sucursal_id);
create index prestamos_proveedor_estado_idx on prestamos_proveedor (estado);

create table prestamo_items (
  id uuid primary key default gen_random_uuid(),
  prestamo_id uuid not null references prestamos_proveedor (id) on delete cascade,
  sku_id uuid not null references skus (id),
  cantidad_prestada integer not null check (cantidad_prestada > 0),
  -- Acumula lo que ya volvio, para permitir devolucion parcial (decision
  -- 2). Cada reintegro, parcial o no, ademas queda su propia fila en
  -- movimientos_stock (tipo 'prestamo_entrada') con fecha y usuario: esto
  -- es el total corriente, la historia real esta en movimientos_stock.
  cantidad_devuelta integer not null default 0 check (cantidad_devuelta >= 0),
  check (cantidad_devuelta <= cantidad_prestada)
);

create index prestamo_items_prestamo_id_idx on prestamo_items (prestamo_id);
create index prestamo_items_sku_id_idx on prestamo_items (sku_id);

-- =========================================================
-- Bloqueo de escritura directa -- mismo mecanismo que
-- ventas/cajas/devoluciones: solo las funciones de abajo escriben.
-- =========================================================

create or replace function bloquear_escritura_directa_prestamos()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('bebidas_moe.prestamo_en_curso', true), 'off') <> 'on' then
    raise exception '% solo se modifica a traves de registrar_prestamo_proveedor() o reintegrar_prestamo_proveedor()', tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger prestamos_proveedor_bloquear_escritura_directa
  before insert or update or delete on prestamos_proveedor
  for each row
  execute function bloquear_escritura_directa_prestamos();

create trigger prestamo_items_bloquear_escritura_directa
  before insert or update or delete on prestamo_items
  for each row
  execute function bloquear_escritura_directa_prestamos();

-- =========================================================
-- RLS: solo ve_costos() (decision 3) -- igual que compras y proveedores.
-- Sin politicas de insert/update/delete: solo escriben las funciones
-- SECURITY DEFINER de abajo, mismo criterio que ventas/devoluciones.
-- =========================================================

alter table prestamos_proveedor enable row level security;
alter table prestamo_items enable row level security;

create policy prestamos_proveedor_select on prestamos_proveedor for select using (ve_costos());
create policy prestamo_items_select on prestamo_items for select using (ve_costos());

grant select on prestamos_proveedor, prestamo_items to authenticated;

-- =========================================================
-- registrar_prestamo_proveedor(): crea el prestamo y descuenta stock de
-- cada sku, todo en una transaccion. p_items es un jsonb array:
-- [{sku_id, cantidad}]
-- =========================================================

create or replace function registrar_prestamo_proveedor(
  p_proveedor_id uuid,
  p_items jsonb,
  p_nota text default null,
  p_fecha_estimada_devolucion date default null
)
returns prestamos_proveedor
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sucursal_id uuid;
  v_prestamo_id uuid;
  v_prestamo prestamos_proveedor;
  v_item record;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para prestar mercaderia a un proveedor';
  end if;

  if p_proveedor_id is null or not exists (
    select 1 from proveedores where id = p_proveedor_id and activo = true
  ) then
    raise exception 'El proveedor no existe o esta inactivo';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El prestamo no tiene productos';
  end if;

  select id into v_sucursal_id from sucursales where es_central = true;
  if v_sucursal_id is null then
    raise exception 'No se encontro la sucursal central';
  end if;

  if not opera_sucursal(v_sucursal_id) then
    raise exception 'No tenes permiso para prestar mercaderia desde esta sucursal';
  end if;

  perform set_config('bebidas_moe.prestamo_en_curso', 'on', true);

  insert into prestamos_proveedor (
    proveedor_id, sucursal_id, usuario_id, nota, fecha_estimada_devolucion
  ) values (
    p_proveedor_id, v_sucursal_id, auth.uid(), p_nota, p_fecha_estimada_devolucion
  )
  returning id into v_prestamo_id;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(sku_id uuid, cantidad integer)
  loop
    if v_item.sku_id is null then
      raise exception 'Falta el SKU del prestamo';
    end if;
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'La cantidad prestada debe ser mayor a cero';
    end if;
    if not exists (select 1 from skus where id = v_item.sku_id) then
      raise exception 'El SKU % no existe', v_item.sku_id;
    end if;

    insert into prestamo_items (prestamo_id, sku_id, cantidad_prestada)
    values (v_prestamo_id, v_item.sku_id, v_item.cantidad);

    perform registrar_movimiento(
      p_sku_id => v_item.sku_id,
      p_sucursal_id => v_sucursal_id,
      p_tipo => 'prestamo_salida',
      p_cantidad => v_item.cantidad,
      p_motivo => 'Prestamo a proveedor',
      p_documento_tipo => 'prestamo',
      p_documento_id => v_prestamo_id
    );
  end loop;

  select * into v_prestamo from prestamos_proveedor where id = v_prestamo_id;

  perform set_config('bebidas_moe.prestamo_en_curso', 'off', true);

  return v_prestamo;
end;
$$;

-- =========================================================
-- reintegrar_prestamo_proveedor(): registra lo que vuelve (total o
-- parcial, decision 2) y cierra el prestamo cuando no queda nada
-- pendiente. p_items es un jsonb array: [{sku_id, cantidad}] con lo que
-- se esta reintegrando EN ESTE MOMENTO (no el acumulado).
-- =========================================================

create or replace function reintegrar_prestamo_proveedor(
  p_prestamo_id uuid,
  p_items jsonb
)
returns prestamos_proveedor
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prestamo prestamos_proveedor;
  v_item record;
  v_item_actual record;
  v_pendiente integer;
  v_queda_pendiente boolean;
begin
  if not usuario_activo() then
    raise exception 'Usuario inactivo o no autenticado';
  end if;

  if not ve_costos() then
    raise exception 'No tenes permiso para reintegrar un prestamo a proveedor';
  end if;

  select * into v_prestamo from prestamos_proveedor where id = p_prestamo_id for update;
  if not found then
    raise exception 'El prestamo no existe';
  end if;

  if v_prestamo.estado <> 'activo' then
    raise exception 'Este prestamo ya esta cerrado';
  end if;

  if not opera_sucursal(v_prestamo.sucursal_id) then
    raise exception 'No tenes permiso para reintegrar este prestamo';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No se indico que mercaderia se esta reintegrando';
  end if;

  perform set_config('bebidas_moe.prestamo_en_curso', 'on', true);

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(sku_id uuid, cantidad integer)
  loop
    if v_item.cantidad is null or v_item.cantidad <= 0 then
      raise exception 'La cantidad a reintegrar debe ser mayor a cero';
    end if;

    select * into v_item_actual
    from prestamo_items
    where prestamo_id = p_prestamo_id and sku_id = v_item.sku_id
    for update;

    if not found then
      raise exception 'El SKU % no forma parte de este prestamo', v_item.sku_id;
    end if;

    v_pendiente := v_item_actual.cantidad_prestada - v_item_actual.cantidad_devuelta;
    if v_item.cantidad > v_pendiente then
      raise exception
        'Se esta reintegrando mas de lo pendiente (prestado %, ya devuelto %, pendiente %, intentando reintegrar %)',
        v_item_actual.cantidad_prestada, v_item_actual.cantidad_devuelta, v_pendiente, v_item.cantidad;
    end if;

    update prestamo_items
    set cantidad_devuelta = cantidad_devuelta + v_item.cantidad
    where id = v_item_actual.id;

    perform registrar_movimiento(
      p_sku_id => v_item.sku_id,
      p_sucursal_id => v_prestamo.sucursal_id,
      p_tipo => 'prestamo_entrada',
      p_cantidad => v_item.cantidad,
      p_motivo => 'Reintegro de prestamo a proveedor',
      p_documento_tipo => 'prestamo',
      p_documento_id => p_prestamo_id
    );
  end loop;

  select exists (
    select 1 from prestamo_items
    where prestamo_id = p_prestamo_id and cantidad_devuelta < cantidad_prestada
  ) into v_queda_pendiente;

  if not v_queda_pendiente then
    update prestamos_proveedor
    set estado = 'devuelto', usuario_devolucion_id = auth.uid(), fecha_devolucion = now()
    where id = p_prestamo_id;
  end if;

  select * into v_prestamo from prestamos_proveedor where id = p_prestamo_id;

  perform set_config('bebidas_moe.prestamo_en_curso', 'off', true);

  return v_prestamo;
end;
$$;
