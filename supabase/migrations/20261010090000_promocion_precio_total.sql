-- Promociones: el precio se carga como TOTAL de la promo, por sucursal.
--
-- Pedido del usuario 2026-10-08. Dos cambios sobre el modelo anterior:
--
-- 1. Antes, en un combo había que repartir el precio a mano entre sus
--    productos: Branca $7.200 y Coca $1.800 para que el combo diera $9.000.
--    Ahora se carga el total y listo. El reparto entre los productos lo
--    hace el sistema, en proporción al precio de lista de cada uno, y no se
--    muestra en ninguna pantalla: el ticket dice el nombre de la promo y el
--    total. Ese reparto existe igual porque venta_items guarda un precio
--    por línea (hace falta para el IVA de la factura y para el aviso de
--    precio bajo el costo), pero es una cuenta interna.
--
-- 2. Una promo que corre en las dos sucursales necesita DOS totales:
--    Olavarría y Laprida no manejan los mismos precios. Antes había un solo
--    precio por promoción.
--
-- promociones.sucursal_id se queda como está: null = corre en las dos, con
-- un id = solo en esa. Lo que cambia es que el precio deja de ser uno solo
-- y pasa a ser uno por sucursal donde corre.
--
-- Se puede hacer limpio porque no hay ninguna promoción cargada: las borró
-- la limpieza de datos de prueba del 2026-10-04.

begin;

-- =========================================================
-- promocion_precios
-- =========================================================
-- Mismo patrón que precios_sucursal y recargos_sucursal: el precio vive en
-- su propia fila por sucursal, no en columnas sueltas de la promoción.
-- Agregar una tercera sucursal no cambia el esquema.

create table promocion_precios (
  promocion_id uuid not null references promociones (id) on delete cascade,
  sucursal_id uuid not null references sucursales (id),
  -- Lo que paga el cliente por la promo completa en esa sucursal. En un
  -- combo es el total de todos sus productos juntos; en un 2x, lo que sale
  -- llevar las dos unidades.
  precio_total numeric(12, 2) not null check (precio_total >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (promocion_id, sucursal_id)
);

create index promocion_precios_sucursal_id_idx on promocion_precios (sucursal_id);

comment on table promocion_precios is
  'Total de cada promoción por sucursal. Si no hay fila para una sucursal, la promo no corre ahí.';

alter table promocion_precios enable row level security;

-- Mismo gate que promocion_items: lo lee cualquier usuario activo (el POS
-- de las dos sucursales necesita resolver precios) y lo escribe quien
-- maneja precios (ve_costos()).
create policy promocion_precios_select on promocion_precios for select using (usuario_activo());
create policy promocion_precios_insert on promocion_precios for insert with check (ve_costos());
create policy promocion_precios_update on promocion_precios
  for update using (ve_costos()) with check (ve_costos());
create policy promocion_precios_delete on promocion_precios for delete using (ve_costos());

-- =========================================================
-- promocion_items: se va el precio por producto
-- =========================================================
-- Si quedaran los dos, habría dos fuentes de verdad para el mismo número y
-- en algún momento van a decir cosas distintas. El precio ahora es uno solo
-- por promo y sucursal; lo que le toca a cada producto se calcula.

alter table promocion_items drop column precio_promocional;

commit;

-- =========================================================
-- Permisos
-- =========================================================
-- promocion_precios la escribe la app directo (políticas RLS de insert/
-- update/delete, igual que promociones y promocion_items), así que necesita
-- el grant: sin él la política no llega a evaluarse (ver NOTAS DEL ENTORNO
-- en CLAUDE.md).

grant select on all tables in schema public to authenticated;
grant insert, update, delete on promocion_precios to authenticated;

-- =========================================================
-- guardar_promocion(): ahora recibe los totales por sucursal
-- =========================================================
-- Cuerpo igual al de 20260903090000_bloque_promociones_admin.sql, con dos
-- cambios: los items ya no traen precio, y aparece p_precios con un total
-- por sucursal. Se borra la firma vieja para que no quede una version que
-- siga guardando promociones sin precio.

drop function if exists guardar_promocion(uuid, text, text, uuid, date, date, boolean, jsonb);

create or replace function guardar_promocion(
  p_id uuid,
  p_nombre text,
  p_tipo text,
  p_sucursal_id uuid,
  p_vigente_desde date,
  p_vigente_hasta date,
  p_activo boolean,
  p_items jsonb,
  p_precios jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tipo_actual text;
  v_cantidad_items integer;
  v_cantidad_precios integer;
  v_sucursales_invalidas integer;
begin
  if not ve_costos() then
    raise exception 'No tenes permiso para cargar promociones';
  end if;

  if p_tipo not in ('combo', 'cantidad') then
    raise exception 'Tipo de promocion invalido: %', p_tipo;
  end if;

  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'Falta el nombre de la promocion';
  end if;

  if p_vigente_desde is not null and p_vigente_hasta is not null
     and p_vigente_desde > p_vigente_hasta then
    raise exception 'La vigencia desde no puede ser posterior a la vigencia hasta';
  end if;

  select count(*) into v_cantidad_items from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));
  if v_cantidad_items = 0 then
    raise exception 'La promocion necesita al menos un SKU';
  end if;

  select count(*) into v_cantidad_precios from jsonb_array_elements(coalesce(p_precios, '[]'::jsonb));
  if v_cantidad_precios = 0 then
    raise exception 'Falta el precio de la promocion: sin precio no corre en ninguna sucursal';
  end if;

  -- Si la promo es de una sucursal puntual, no puede traer el precio de
  -- otra: seria un precio que no se va a usar nunca y que despues nadie
  -- entiende por que esta ahi.
  if p_sucursal_id is not null then
    select count(*) into v_sucursales_invalidas
    from jsonb_to_recordset(p_precios) as x(sucursal_id uuid, precio_total numeric)
    where x.sucursal_id <> p_sucursal_id;

    if v_sucursales_invalidas > 0 then
      raise exception 'La promocion es de una sola sucursal: no puede tener el precio de otra';
    end if;
  end if;

  if p_id is not null then
    select tipo into v_tipo_actual from promociones where id = p_id;
    if not found then
      raise exception 'La promocion no existe';
    end if;
    -- El tipo no se puede cambiar en una edicion (cambia la forma que
    -- exige el trigger de promocion_items): para eso se crea una nueva.
    if v_tipo_actual <> p_tipo then
      raise exception 'No se puede cambiar el tipo de una promocion existente';
    end if;

    update promociones set
      nombre = p_nombre,
      sucursal_id = p_sucursal_id,
      vigente_desde = p_vigente_desde,
      vigente_hasta = p_vigente_hasta,
      activo = coalesce(p_activo, true)
    where id = p_id;

    v_id := p_id;

    delete from promocion_items where promocion_id = v_id;
    delete from promocion_precios where promocion_id = v_id;
  else
    insert into promociones (nombre, tipo, sucursal_id, vigente_desde, vigente_hasta, activo)
    values (p_nombre, p_tipo, p_sucursal_id, p_vigente_desde, p_vigente_hasta, coalesce(p_activo, true))
    returning id into v_id;
  end if;

  insert into promocion_items (promocion_id, sku_id, cantidad_requerida)
  select v_id, x.sku_id, x.cantidad_requerida
  from jsonb_to_recordset(p_items) as x(sku_id uuid, cantidad_requerida integer);

  insert into promocion_precios (promocion_id, sucursal_id, precio_total)
  select v_id, x.sucursal_id, x.precio_total
  from jsonb_to_recordset(p_precios) as x(sucursal_id uuid, precio_total numeric);

  return v_id;
end;
$$;
