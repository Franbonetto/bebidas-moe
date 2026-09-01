-- Bloque 5: precios (base Olavarria, cascada de cerveza en lata, recargo de
-- Laprida por categoria y por SKU, descuento por efectivo).
-- Ver docs/arquitectura.md, secciones 1.7 (precios y promociones) y 2.7
-- (modelo de datos), y el chat de bloque 5 para las reglas reales que el
-- cliente confirmo (difieren del "monto tentativo" que trae el documento).
--
-- Decision de diseno: el precio de venta NO se calcula ni se cachea en una
-- columna -- se resuelve al vuelo (en la app, lib/precios.ts) a partir de
-- costo_actual + estas tablas. Evita el problema de precios
-- desactualizados cuando entra una compra nueva (confirmar_recepcion()
-- actualiza costo_actual solo; si el precio quedara guardado en una
-- columna, alguien tendria que acordarse de recalcularlo).
--
-- La cascada de cerveza en lata (unidad/x6/x24) queda COMPLETAMENTE fuera
-- del sistema de recargos por categoria/SKU: Laprida no suma un monto fijo
-- sobre el precio de Olavarria, tiene su propia cascada que parte del x6 y
-- x24 de Olavarria. Por eso hay triggers que impiden cargar un recargo o un
-- precio manual para un SKU marcado `cascada_cerveza_lata` -- esos casos se
-- calculan solos, y la unica forma de pisarlos es `precios_sucursal`
-- (override explicito, marcado como excepcion).

-- =========================================================
-- skus: marca que participa de la cascada de cerveza en lata
-- =========================================================
-- Se marca en los 3 SKU de una familia (unidad, pack x6, pack x24) que
-- comparten producto_id. No hay forma de derivar "es lata" de otra columna
-- existente (volumen/unidad_volumen no distinguen lata de botella), asi que
-- es una marca explicita que carga quien da de alta el SKU.

alter table skus
  add column cascada_cerveza_lata boolean not null default false;

-- =========================================================
-- Tablas
-- =========================================================

create table precios (
  -- Precio base de Olavarria, cargado a mano. Los SKU de cascada de
  -- cerveza NUNCA tienen fila aca (trigger mas abajo) -- su precio se
  -- calcula solo a partir de costo_actual.
  sku_id uuid primary key references skus (id),
  precio_base numeric(12, 2) not null check (precio_base >= 0),
  actualizado_en timestamptz not null default now()
);

create table precios_sucursal (
  -- Override manual por sucursal + SKU. Prioridad maxima: si existe fila
  -- aca, gana por sobre precio base, recargo o cascada. Sirve tanto para
  -- Laprida (excepcion sobre el recargo de categoria) como para Olavarria
  -- en un SKU de cascada (unica forma de pisar la cascada -- ver trigger).
  sucursal_id uuid not null references sucursales (id),
  sku_id uuid not null references skus (id),
  precio_override numeric(12, 2) not null check (precio_override >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (sucursal_id, sku_id)
);

create index precios_sucursal_sku_id_idx on precios_sucursal (sku_id);

create table recargos_sucursal (
  -- Monto fijo por categoria, multiplicado por unidades_contenidas al
  -- calcular el precio de Laprida (arquitectura.md 1.7). Editable desde la
  -- interfaz -- por eso es tabla y no una constante en el codigo.
  sucursal_id uuid not null references sucursales (id),
  categoria_id uuid not null references categorias (id),
  monto_fijo numeric(12, 2) not null check (monto_fijo >= 0),
  -- Fecha de ultima edicion: arquitectura.md advierte que estos montos se
  -- licuan con la inflacion si nadie los revisa, hay que poder ver cuando
  -- quedaron viejos.
  actualizado_en timestamptz not null default now(),
  primary key (sucursal_id, categoria_id)
);

create table recargos_sku (
  -- Excepcion puntual que pisa el recargo de categoria para un SKU
  -- especifico (ej. Absolut, La Scala). Misma formula que recargos_sucursal
  -- (monto_fijo x unidades_contenidas), solo cambia el monto.
  sucursal_id uuid not null references sucursales (id),
  sku_id uuid not null references skus (id),
  monto_fijo numeric(12, 2) not null check (monto_fijo >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (sucursal_id, sku_id)
);

create table descuentos_efectivo (
  -- Descuento por pagar en efectivo (billete en mano, no debito/credito/
  -- transferencia -- arquitectura.md 1.7), por categoria y sucursal. Hoy
  -- solo existe (Olavarria, Vinos, 10%), pero no se hardcodea: el cliente
  -- lo va a ajustar. Distinto del motor de promociones (combo/cantidad/
  -- promocional), que se implementa en el bloque de POS.
  sucursal_id uuid not null references sucursales (id),
  categoria_id uuid not null references categorias (id),
  porcentaje numeric(5, 2) not null check (porcentaje > 0 and porcentaje <= 100),
  actualizado_en timestamptz not null default now(),
  primary key (sucursal_id, categoria_id)
);

-- =========================================================
-- actualizado_en: se toca solo, nadie lo carga a mano
-- =========================================================

create or replace function tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger precios_tocar_actualizado_en
  before update on precios
  for each row
  execute function tocar_actualizado_en();

create trigger precios_sucursal_tocar_actualizado_en
  before update on precios_sucursal
  for each row
  execute function tocar_actualizado_en();

create trigger recargos_sucursal_tocar_actualizado_en
  before update on recargos_sucursal
  for each row
  execute function tocar_actualizado_en();

create trigger recargos_sku_tocar_actualizado_en
  before update on recargos_sku
  for each row
  execute function tocar_actualizado_en();

create trigger descuentos_efectivo_tocar_actualizado_en
  before update on descuentos_efectivo
  for each row
  execute function tocar_actualizado_en();

-- =========================================================
-- precios: un SKU de cascada de cerveza no puede tener precio manual
-- =========================================================

create or replace function validar_precio_manual_no_cascada()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from skus where id = new.sku_id and cascada_cerveza_lata = true
  ) then
    raise exception
      'Este SKU es parte de la cascada de cerveza en lata: el precio se calcula solo a partir del costo, no se carga a mano (usa precios_sucursal si necesitas una excepcion puntual)';
  end if;
  return new;
end;
$$;

create trigger precios_validar_no_cascada
  before insert or update on precios
  for each row
  execute function validar_precio_manual_no_cascada();

-- =========================================================
-- precios_sucursal: en la sucursal central, override solo para cascada
-- =========================================================
-- Un SKU que no es de cascada ya tiene su precio de Olavarria editable
-- directo en `precios.precio_base` -- permitir ademas un override en
-- precios_sucursal para (central, ese SKU) crearia dos lugares para cargar
-- el mismo numero, sin que quede claro cual gana. Para un SKU de cascada,
-- en cambio, `precios` esta bloqueada (trigger de arriba) y esta es la
-- UNICA forma de fijar una excepcion manual en Olavarria.
-- En Laprida no hay esta restriccion: el override siempre esta disponible,
-- sea la cascada de cerveza o el recargo por categoria lo que rompe.

create or replace function validar_precios_sucursal_central()
returns trigger
language plpgsql
as $$
declare
  v_es_central boolean;
  v_es_cascada boolean;
begin
  select es_central into v_es_central from sucursales where id = new.sucursal_id;
  select cascada_cerveza_lata into v_es_cascada from skus where id = new.sku_id;

  if v_es_central and not coalesce(v_es_cascada, false) then
    raise exception
      'En la sucursal central el precio de este SKU se edita directo en precios.precio_base; el override manual solo aplica a SKU de cascada de cerveza en lata';
  end if;

  return new;
end;
$$;

create trigger precios_sucursal_validar_central
  before insert or update on precios_sucursal
  for each row
  execute function validar_precios_sucursal_central();

-- =========================================================
-- recargos_sku: un SKU de cascada de cerveza no usa el sistema de recargos
-- =========================================================

create or replace function validar_recargo_sku_no_cascada()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from skus where id = new.sku_id and cascada_cerveza_lata = true
  ) then
    raise exception
      'Este SKU es parte de la cascada de cerveza en lata: no usa el sistema de recargos por categoria/SKU, tiene su propia cascada en Laprida (usa precios_sucursal para una excepcion puntual)';
  end if;
  return new;
end;
$$;

create trigger recargos_sku_validar_no_cascada
  before insert or update on recargos_sku
  for each row
  execute function validar_recargo_sku_no_cascada();

-- =========================================================
-- RLS
-- =========================================================
-- precios / precios_sucursal: cualquier usuario activo lee (arquitectura.md
-- 1.11 -- "Precios de venta: lectura" para ambos encargados), solo el
-- dueño edita (misma fila: "edita" es exclusivo del dueño).
--
-- recargos_sucursal / recargos_sku / descuentos_efectivo: lectura
-- ve_costos() (dueño + encargado Olavarria) -- son el "por que" del precio
-- de Laprida, mismo tratamiento que costos y margen (1.11). El encargado
-- de Laprida ve el precio final, no la composicion. Escritura solo dueño.

alter table precios enable row level security;
alter table precios_sucursal enable row level security;
alter table recargos_sucursal enable row level security;
alter table recargos_sku enable row level security;
alter table descuentos_efectivo enable row level security;

create policy precios_select on precios for select using (usuario_activo());
create policy precios_insert on precios for insert with check (es_dueno());
create policy precios_update on precios for update using (es_dueno()) with check (es_dueno());
create policy precios_delete on precios for delete using (es_dueno());

create policy precios_sucursal_select on precios_sucursal for select using (usuario_activo());
create policy precios_sucursal_insert on precios_sucursal for insert with check (es_dueno());
create policy precios_sucursal_update on precios_sucursal for update using (es_dueno()) with check (es_dueno());
create policy precios_sucursal_delete on precios_sucursal for delete using (es_dueno());

create policy recargos_sucursal_select on recargos_sucursal for select using (ve_costos());
create policy recargos_sucursal_insert on recargos_sucursal for insert with check (es_dueno());
create policy recargos_sucursal_update on recargos_sucursal for update using (es_dueno()) with check (es_dueno());
create policy recargos_sucursal_delete on recargos_sucursal for delete using (es_dueno());

create policy recargos_sku_select on recargos_sku for select using (ve_costos());
create policy recargos_sku_insert on recargos_sku for insert with check (es_dueno());
create policy recargos_sku_update on recargos_sku for update using (es_dueno()) with check (es_dueno());
create policy recargos_sku_delete on recargos_sku for delete using (es_dueno());

create policy descuentos_efectivo_select on descuentos_efectivo for select using (ve_costos());
create policy descuentos_efectivo_insert on descuentos_efectivo for insert with check (es_dueno());
create policy descuentos_efectivo_update on descuentos_efectivo for update using (es_dueno()) with check (es_dueno());
create policy descuentos_efectivo_delete on descuentos_efectivo for delete using (es_dueno());

-- =========================================================
-- Permisos base (ver notas del entorno en CLAUDE.md)
-- =========================================================

grant select on all tables in schema public to authenticated;

grant insert, update, delete on precios to authenticated;
grant insert, update, delete on precios_sucursal to authenticated;
grant insert, update, delete on recargos_sucursal to authenticated;
grant insert, update, delete on recargos_sku to authenticated;
grant insert, update, delete on descuentos_efectivo to authenticated;

-- =========================================================
-- Seed: categorias reales que faltaban + recargos + descuento efectivo
-- =========================================================
-- Gin y Fernet ya existen como subcategoria de Destilados (bloque 2).
-- Whisky, Vodka y Licores son igual de "destilados" -- mismo criterio.
-- Vinos, Gaseosas, Mani con cascara y Quesos no encajan ahi, quedan como
-- categorias de primer nivel (hermanas de Cerveza/Destilados).

insert into categorias (nombre, categoria_padre_id) values
  ('Whisky', (select id from categorias where nombre = 'Destilados')),
  ('Vodka', (select id from categorias where nombre = 'Destilados')),
  ('Licores', (select id from categorias where nombre = 'Destilados'));

insert into categorias (nombre) values
  ('Vinos'),
  ('Gaseosas'),
  ('Maní con cáscara'),
  ('Quesos');

insert into recargos_sucursal (sucursal_id, categoria_id, monto_fijo)
select
  (select id from sucursales where es_central = false),
  c.id,
  datos.monto
from (values
  ('Vinos', 500),
  ('Whisky', 1000),
  ('Gin', 1000),
  ('Vodka', 50),
  ('Gaseosas', 50),
  ('Licores', 500),
  ('Maní con cáscara', 4000)
) as datos(nombre, monto)
join categorias c on c.nombre = datos.nombre;

-- Fernet y Quesos quedan sin fila: sin recargo (arquitectura.md, mismo
-- criterio que "sin fila = $0" en toda la app).

insert into descuentos_efectivo (sucursal_id, categoria_id, porcentaje)
values (
  (select id from sucursales where es_central = true),
  (select id from categorias where nombre = 'Vinos'),
  10
);

-- Quilmes Clasica ya tiene las 3 presentaciones (unidad/x6/x24) cargadas en
-- el bloque 2, con la cadena de desarme completa: sirve tal cual como
-- ejemplo real de familia de cascada de cerveza en lata.

update skus set cascada_cerveza_lata = true
where codigo_interno in ('QUI-CLAS-UN', 'QUI-CLAS-X6', 'QUI-CLAS-X24');
