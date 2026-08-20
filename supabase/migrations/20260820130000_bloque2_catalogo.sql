-- Bloque 2: catalogo (marcas, categorias, productos, tipos_envase, skus) + RLS + seed
-- Ver docs/arquitectura.md, secciones 1.3 (productos y SKU) y 2.2 (catalogo).

-- =========================================================
-- Tablas
-- =========================================================

create table marcas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true
);

create table categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  -- Jerarquia de 2 niveles en la practica (ej. Destilados > Fernet). NULL = raiz.
  categoria_padre_id uuid references categorias (id),
  activo boolean not null default true,
  check (id <> categoria_padre_id)
);

create index categorias_padre_id_idx on categorias (categoria_padre_id);

create table productos (
  id uuid primary key default gen_random_uuid(),
  -- Concepto comercial ("Fernet Branca"). Sabores/variedades son productos
  -- distintos, no variantes: Branca Menta y Fernet Branca comparten marca
  -- pero no fila aca (arquitectura.md 1.3).
  nombre text not null,
  marca_id uuid not null references marcas (id),
  categoria_id uuid not null references categorias (id),
  activo boolean not null default true,
  unique (marca_id, nombre)
);

create index productos_marca_id_idx on productos (marca_id);
create index productos_categoria_id_idx on productos (categoria_id);

create table tipos_envase (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  -- Generico = compartido entre marcas (litro retornable comun). Especifico
  -- = solo una marca lo usa. Solo botellas, los cajones no se controlan
  -- como activo separado (arquitectura.md 1.4).
  es_generico boolean not null default false,
  valor_deposito numeric(12, 2) not null default 0,
  activo boolean not null default true
);

create table skus (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos (id),
  nombre text not null,
  -- codigo_interno existe desde el alta; codigo_barras se carga
  -- progresivamente (arquitectura.md 1.14) por eso es el unico nullable.
  codigo_interno text not null unique,
  codigo_barras text unique,
  volumen numeric not null,
  unidad_volumen text not null check (unidad_volumen in ('ml', 'l')),
  tipo_presentacion text not null
    check (tipo_presentacion in ('unidad', 'pack', 'cajon', 'estuche')),
  -- Cuantas unidades base contiene. Multiplica el recargo fijo por
  -- categoria al calcular el precio de Laprida (arquitectura.md 1.7).
  unidades_contenidas integer not null default 1 check (unidades_contenidas > 0),
  -- Cascada de desarme: x24 -> 4x x6 -> 6x unidad. Cada SKU declara en que
  -- se desarma y con que factor; se sigue la cadena hasta el SKU no
  -- desarmable (arquitectura.md 1.3). Los packs NO se desarman solos al
  -- vender, esto es solo el dato de a que da lugar un desarme manual.
  desarma_en_sku_id uuid references skus (id),
  desarma_en_cantidad integer check (desarma_en_cantidad > 0),
  check ((desarma_en_sku_id is null) = (desarma_en_cantidad is null)),
  -- Envases se controlan por tipo, no por producto (arquitectura.md 1.4).
  -- tipo_envase_id solo tiene sentido si el SKU es retornable.
  es_retornable boolean not null default false,
  tipo_envase_id uuid references tipos_envase (id),
  check (es_retornable = (tipo_envase_id is not null)),
  -- Para Etapa 2 (factura A con IVA discriminado). No todo es 21%, se
  -- confirma con el contador por categoria (arquitectura.md 1.8).
  alicuota_iva numeric(5, 2) not null default 21.00,
  -- Lo escribe el modulo de compras (bloque 4) al confirmar una recepcion.
  -- Aca solo la columna: costo del ultimo lote recibido.
  costo_actual numeric(12, 2),
  stock_minimo integer not null default 0,
  stock_objetivo integer not null default 0,
  activo boolean not null default true,
  imagen_url text
);

create index skus_producto_id_idx on skus (producto_id);
create index skus_desarma_en_sku_id_idx on skus (desarma_en_sku_id);
create index skus_tipo_envase_id_idx on skus (tipo_envase_id);

-- =========================================================
-- RLS
-- =========================================================
-- Lectura: cualquier usuario activo (POS, pedidos e inventarios en ambas
-- sucursales necesitan ver el catalogo completo). Escritura: dueno o
-- encargado de Olavarria unicamente (ve_costos(), definida en el bloque 1).
--
-- El catalogo tiene un solo responsable a proposito: si las dos sucursales
-- pudieran dar de alta productos, en poco tiempo aparecen duplicados
-- ("Fernet Branca 750" y "Branca 750ml" como SKU distintos) con el stock
-- partido entre ambos. Laprida solo lee.

alter table marcas enable row level security;
alter table categorias enable row level security;
alter table productos enable row level security;
alter table tipos_envase enable row level security;
alter table skus enable row level security;

create policy marcas_select on marcas
  for select
  using (usuario_activo());

create policy marcas_insert on marcas
  for insert
  with check (ve_costos());

create policy marcas_update on marcas
  for update
  using (ve_costos())
  with check (ve_costos());

create policy marcas_delete on marcas
  for delete
  using (ve_costos());

create policy categorias_select on categorias
  for select
  using (usuario_activo());

create policy categorias_insert on categorias
  for insert
  with check (ve_costos());

create policy categorias_update on categorias
  for update
  using (ve_costos())
  with check (ve_costos());

create policy categorias_delete on categorias
  for delete
  using (ve_costos());

create policy productos_select on productos
  for select
  using (usuario_activo());

create policy productos_insert on productos
  for insert
  with check (ve_costos());

create policy productos_update on productos
  for update
  using (ve_costos())
  with check (ve_costos());

create policy productos_delete on productos
  for delete
  using (ve_costos());

create policy tipos_envase_select on tipos_envase
  for select
  using (usuario_activo());

create policy tipos_envase_insert on tipos_envase
  for insert
  with check (ve_costos());

create policy tipos_envase_update on tipos_envase
  for update
  using (ve_costos())
  with check (ve_costos());

create policy tipos_envase_delete on tipos_envase
  for delete
  using (ve_costos());

create policy skus_select on skus
  for select
  using (usuario_activo());

create policy skus_insert on skus
  for insert
  with check (ve_costos());

create policy skus_update on skus
  for update
  using (ve_costos())
  with check (ve_costos());

create policy skus_delete on skus
  for delete
  using (ve_costos());

-- =========================================================
-- Seed
-- =========================================================
-- Catalogo real de ejemplo: una cerveza con sus tres presentaciones
-- (para probar la cascada de desarme completa) mas una botella retornable,
-- un fernet con su variante de sabor, y dos gins. codigo_barras queda NULL
-- a proposito: se carga progresivamente (arquitectura.md 1.14), no se
-- inventan codigos falsos.

insert into categorias (nombre) values
  ('Cerveza'),
  ('Destilados');

insert into categorias (nombre, categoria_padre_id) values
  ('Fernet', (select id from categorias where nombre = 'Destilados')),
  ('Gin', (select id from categorias where nombre = 'Destilados'));

insert into marcas (nombre) values
  ('Quilmes'),
  ('Branca'),
  ('Gordon''s');

insert into tipos_envase (nombre, es_generico, valor_deposito) values
  ('Litro retornable genérico', true, 800);

insert into productos (nombre, marca_id, categoria_id) values
  ('Quilmes Clásica',
    (select id from marcas where nombre = 'Quilmes'),
    (select id from categorias where nombre = 'Cerveza')),
  ('Fernet Branca',
    (select id from marcas where nombre = 'Branca'),
    (select id from categorias where nombre = 'Fernet')),
  ('Branca Menta',
    (select id from marcas where nombre = 'Branca'),
    (select id from categorias where nombre = 'Fernet')),
  ('Gordon''s London Dry',
    (select id from marcas where nombre = 'Gordon''s'),
    (select id from categorias where nombre = 'Gin')),
  ('Gordon''s Pink',
    (select id from marcas where nombre = 'Gordon''s'),
    (select id from categorias where nombre = 'Gin'));

-- Quilmes Clásica: se inserta primero el eslabon final de la cadena de
-- desarme (unidad) para poder referenciarlo desde el pack x6, y este a su
-- vez desde el pack x24.

insert into skus (
  producto_id, nombre, codigo_interno, volumen, unidad_volumen,
  tipo_presentacion, unidades_contenidas
) values (
  (select id from productos where nombre = 'Quilmes Clásica'),
  'Quilmes Clásica lata 354ml', 'QUI-CLAS-UN', 354, 'ml', 'unidad', 1
);

insert into skus (
  producto_id, nombre, codigo_interno, volumen, unidad_volumen,
  tipo_presentacion, unidades_contenidas,
  desarma_en_sku_id, desarma_en_cantidad
) values (
  (select id from productos where nombre = 'Quilmes Clásica'),
  'Quilmes Clásica pack x6 latas 354ml', 'QUI-CLAS-X6', 354, 'ml', 'pack', 6,
  (select id from skus where codigo_interno = 'QUI-CLAS-UN'), 6
);

insert into skus (
  producto_id, nombre, codigo_interno, volumen, unidad_volumen,
  tipo_presentacion, unidades_contenidas,
  desarma_en_sku_id, desarma_en_cantidad
) values (
  (select id from productos where nombre = 'Quilmes Clásica'),
  'Quilmes Clásica pack x24 latas 354ml', 'QUI-CLAS-X24', 354, 'ml', 'pack', 24,
  (select id from skus where codigo_interno = 'QUI-CLAS-X6'), 4
);

insert into skus (
  producto_id, nombre, codigo_interno, volumen, unidad_volumen,
  tipo_presentacion, unidades_contenidas, es_retornable, tipo_envase_id
) values (
  (select id from productos where nombre = 'Quilmes Clásica'),
  'Quilmes Clásica botella 1L retornable', 'QUI-CLAS-1L-RET', 1, 'l', 'unidad', 1,
  true, (select id from tipos_envase where nombre = 'Litro retornable genérico')
);

insert into skus (
  producto_id, nombre, codigo_interno, volumen, unidad_volumen,
  tipo_presentacion, unidades_contenidas
) values
  ((select id from productos where nombre = 'Fernet Branca'),
    'Fernet Branca 750cc', 'BRANCA-750', 750, 'ml', 'unidad', 1),
  ((select id from productos where nombre = 'Branca Menta'),
    'Branca Menta 750cc', 'BRANCA-MENTA-750', 750, 'ml', 'unidad', 1),
  ((select id from productos where nombre = 'Gordon''s London Dry'),
    'Gordon''s London Dry 750cc', 'GORDONS-LD-750', 750, 'ml', 'unidad', 1),
  ((select id from productos where nombre = 'Gordon''s Pink'),
    'Gordon''s Pink 700cc', 'GORDONS-PINK-700', 700, 'ml', 'unidad', 1);
