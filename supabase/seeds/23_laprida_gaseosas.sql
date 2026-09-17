-- Carga real de catálogo + precios de Laprida — sección "GASEOSAS /
-- JUGOS" de la lista de Laprida (12/09/26). Reusa marcas/productos de
-- 10_gaseosas_y_combos.sql donde matchea; el resto es alta nueva.
--
-- Confirma algo que había quedado como pendiente explícito en
-- 10_gaseosas_y_combos.sql: "Cepita" solo existía como pack x6 mayorista
-- (sin unidad suelta con precio). Ahora la lista de Laprida sí trae
-- "Cepita 1 L $2.750" como unidad -- se agrega el tier "unidad" de la
-- cascada existente (desarma del pack x6, factor 6), mismo criterio que
-- se usó para las latas de cerveza.
--
-- "Schweppes 1.5L/2.25L" ya cargado en la tanda anterior se toma como la
-- variante Tónica (así se documentó ahí: es el mixer de los combos de
-- Gin) -- se le agrega el override de Laprida. "Schweppes Pomelo" es
-- sabor nuevo, no existía, se da de alta como producto aparte (mismo
-- criterio de sabor = producto distinto de toda la lista).
--
-- "Coca-Cola Zero" tampoco existía (solo "Coca-Cola" genérica) -- alta
-- nueva como producto aparte, mismo criterio.
--
-- Volúmenes de las bebidas en lata de esta sección (Monster, Gancia One,
-- Santa Julia lata, Dr. Lemon) NO están en la planilla -- se asumió el
-- formato real de lata más común de cada marca (Monster 473cc, Speed
-- 250cc/500cc ya viene explícito, Gancia One y Santa Julia lata 269cc
-- como los demás RTD en lata de esta lista, Dr. Lemon lata 354cc y
-- botella 500cc). Si algún tamaño está mal, se corrige después.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values ('Monster'), ('Speed'), ('Dr. Lemon');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Gaseosas')
from (values
  ('Coca-Cola Zero', 'Coca-Cola'),
  ('Schweppes Pomelo', 'Schweppes'),
  ('Monster', 'Monster'),
  ('Speed', 'Speed'),
  ('Gancia One', 'Gancia'),
  ('Santa Julia Lata', 'Santa Julia'),
  ('Dr. Lemon', 'Dr. Lemon')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('Coca-Cola Zero', 'Coca-Cola Zero 1.5L', 'GASEOSA-COCACOLAZERO-1500', 1500),
  ('Coca-Cola Zero', 'Coca-Cola Zero 2.25L', 'GASEOSA-COCACOLAZERO-2250', 2250),
  ('Schweppes Pomelo', 'Schweppes Pomelo 1.5L', 'GASEOSA-SCHWEPPES-POMELO-1500', 1500),
  ('Schweppes Pomelo', 'Schweppes Pomelo 2.25L', 'GASEOSA-SCHWEPPES-POMELO-2250', 2250),
  ('Monster', 'Monster Lata 473cc', 'GASEOSA-MONSTER-473-UN', 473),
  ('Speed', 'Speed 250cc', 'GASEOSA-SPEED-250-UN', 250),
  ('Speed', 'Speed 500cc', 'GASEOSA-SPEED-500-UN', 500),
  ('Gancia One', 'Gancia One Lata 269cc', 'GASEOSA-GANCIAONE-269-UN', 269),
  ('Santa Julia Lata', 'Santa Julia Lata 269cc', 'GASEOSA-SANTAJULIA-LATA-269-UN', 269),
  ('Dr. Lemon', 'Dr. Lemon Lata 354cc', 'GASEOSA-DRLEMON-LATA-354-UN', 354),
  ('Dr. Lemon', 'Dr. Lemon Botella 500cc', 'GASEOSA-DRLEMON-BOTELLA-500-UN', 500)
) as v(producto, nombre_sku, codigo, volumen)
join productos p on p.nombre = v.producto
  and p.categoria_id = (select id from categorias where nombre = 'Gaseosas');

-- SKU que completa la cascada existente de Cepita (desarma del pack x6)
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, desarma_en_sku_id, desarma_en_cantidad)
select p.id, 'Cepita 1L', 'GASEOSA-CEPITA-1000-UN', 'unidad', 1000, 'ml', 1,
  (select id from skus where codigo_interno = 'GASEOSA-CEPITA-1000-X6'), 6
from productos p
join marcas m on m.id = p.marca_id and m.nombre = 'Cepita'
where p.nombre = 'Cepita';

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  -- Overrides sobre SKUs existentes (10_gaseosas_y_combos.sql)
  ('GASEOSA-COCACOLA-1500', 4150),
  ('GASEOSA-COCACOLA-2250', 5550),
  ('GASEOSA-COCACOLA-3000', 6450),
  ('GASEOSA-SPRITE-1500', 4150),
  ('GASEOSA-SPRITE-2250', 5550),
  ('GASEOSA-SPRITE-3000', 6450),
  ('GASEOSA-AQUARIUS-1500', 3400),
  ('GASEOSA-AQUARIUS-2250', 4350),
  ('GASEOSA-SCHWEPPES-1500', 4150),
  ('GASEOSA-SCHWEPPES-2250', 5550),
  -- SKUs nuevos
  ('GASEOSA-COCACOLAZERO-1500', 4150),
  ('GASEOSA-COCACOLAZERO-2250', 5550),
  ('GASEOSA-SCHWEPPES-POMELO-1500', 4150),
  ('GASEOSA-SCHWEPPES-POMELO-2250', 5550),
  ('GASEOSA-CEPITA-1000-UN', 2750),
  ('GASEOSA-MONSTER-473-UN', 3000),
  ('GASEOSA-SPEED-250-UN', 1700),
  ('GASEOSA-SPEED-500-UN', 2700),
  ('GASEOSA-GANCIAONE-269-UN', 4000),
  ('GASEOSA-SANTAJULIA-LATA-269-UN', 3000),
  ('GASEOSA-DRLEMON-LATA-354-UN', 4000),
  ('GASEOSA-DRLEMON-BOTELLA-500-UN', 5000)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
