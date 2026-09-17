-- Carga real de catálogo — GASEOSAS + combos cruzados pendientes
-- (décima y última tanda de esta lista).
-- Fuente: lista de precios de Moe, sección "Gaseosas por mayor" + todos
-- los combos de Fernet/Gin/Vodka que quedaron pendientes en tandas
-- anteriores por depender de un mixer que todavía no existía.
--
-- Supuestos:
--   1. "Schweppes" se asumió como la "tónica" de los combos de Gin (Merle
--      + tónica, Cordillera + tónica, Burnett's + tónica): la lista nunca
--      dice la palabra "tónica" junto a una marca, pero las tres cuentas
--      cierran EXACTO con Schweppes 1.5L valiendo $3.900 dentro del
--      combo (Merle $8.450 + $3.900 = $12.350 ✓, Cordillera $16.700 +
--      $3.900 = $20.600 ✓, Burnett's $8.000 + $3.900 = $11.900 ✓) --
--      la consistencia entre las tres confirma la suposición.
--   2. Cada combo es tipo 'combo' con dos items: el producto base (con su
--      propio precio de lista, ya cargado) y el mixer "dentro del combo"
--      (lo que falta para llegar al total -- arquitectura.md 1.7 y
--      decision 2 de la migracion del bloque 6: cada item tiene su propio
--      precio, no hay un campo de "total" separado).
--   3. "Cordillera + 1 tónica" no aclara si es London Dry o Pink (mismo
--      precio los dos) -- se usó Cordillera London Dry.
--   4. NO se cargaron los combos "+ 1 jugo" (Skyy/Smirnoff/Sernova + 1
--      jugo, 5 combos) -- "jugo" nunca tiene precio ni marca propia en
--      ningún lado de la lista (Cepita aparece como pack x6 mayorista,
--      no como unidad suelta de mostrador). Si me confirmás qué produce
--      es el "jugo" del combo y su precio, los cargo.
--   5. NO se cargó "Branca 450cc + Coca-Cola 2.25 $16.100": Branca 450cc
--      sigue sin precio propio (viene de la tanda de Fernet), así que no
--      hay forma de calcular cuánto vale la Coca dentro de ESE combo sin
--      inventar un número.
--   6. NO se cargaron los cajones retornables de vidrio (Coca-Cola/
--      Sprite/Fanta 2L x9 y 1.5 x8): son un envase compartido entre
--      variasmarcas con un precio único por cajón, lo que no encaja bien
--      en el modelo SKU-por-producto sin inventar una regla -- lo dejo
--      para definir aparte si hace falta venderlos.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Gaseosas');

insert into marcas (nombre) values
  ('Coca-Cola'), ('Sprite'), ('Schweppes'), ('Aquarius'), ('Powerade'), ('Cepita'), ('Ivess');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Gaseosas')
from (values
  ('Coca-Cola', 'Coca-Cola'),
  ('Sprite', 'Sprite'),
  ('Schweppes', 'Schweppes'),
  ('Aquarius', 'Aquarius'),
  ('Powerade', 'Powerade'),
  ('Cepita', 'Cepita'),
  ('Agua Mineral Ivess', 'Ivess')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, v.tipo, v.volumen, 'ml', v.unidades
from (values
  ('Coca-Cola', 'Coca-Cola', 'Coca-Cola 500cc', 'GASEOSA-COCACOLA-500', 'unidad', 500, 1),
  ('Coca-Cola', 'Coca-Cola', 'Coca-Cola 1.5L', 'GASEOSA-COCACOLA-1500', 'unidad', 1500, 1),
  ('Coca-Cola', 'Coca-Cola', 'Coca-Cola 2.25L', 'GASEOSA-COCACOLA-2250', 'unidad', 2250, 1),
  ('Coca-Cola', 'Coca-Cola', 'Coca-Cola 3L', 'GASEOSA-COCACOLA-3000', 'unidad', 3000, 1),
  ('Sprite', 'Sprite', 'Sprite 500cc', 'GASEOSA-SPRITE-500', 'unidad', 500, 1),
  ('Sprite', 'Sprite', 'Sprite 1.5L', 'GASEOSA-SPRITE-1500', 'unidad', 1500, 1),
  ('Sprite', 'Sprite', 'Sprite 2.25L', 'GASEOSA-SPRITE-2250', 'unidad', 2250, 1),
  ('Sprite', 'Sprite', 'Sprite 3L', 'GASEOSA-SPRITE-3000', 'unidad', 3000, 1),
  ('Schweppes', 'Schweppes', 'Schweppes 1.5L', 'GASEOSA-SCHWEPPES-1500', 'unidad', 1500, 1),
  ('Schweppes', 'Schweppes', 'Schweppes 2.25L', 'GASEOSA-SCHWEPPES-2250', 'unidad', 2250, 1),
  ('Aquarius', 'Aquarius', 'Aquarius 500cc', 'GASEOSA-AQUARIUS-500', 'unidad', 500, 1),
  ('Aquarius', 'Aquarius', 'Aquarius 1.5L', 'GASEOSA-AQUARIUS-1500', 'unidad', 1500, 1),
  ('Aquarius', 'Aquarius', 'Aquarius 2.25L', 'GASEOSA-AQUARIUS-2250', 'unidad', 2250, 1),
  ('Powerade', 'Powerade', 'Powerade 500cc', 'GASEOSA-POWERADE-500', 'unidad', 500, 1),
  ('Cepita', 'Cepita', 'Cepita Pack x6 · 1L', 'GASEOSA-CEPITA-1000-X6', 'pack', 1000, 6),
  ('Agua Mineral Ivess', 'Ivess', 'Agua Mineral Ivess 500cc', 'GASEOSA-IVESS-500', 'unidad', 500, 1)
) as v(producto, marca, nombre_sku, codigo, tipo, volumen, unidades)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- Precios (los 500cc de Coca-Cola, Sprite, Aquarius y Powerade quedan sin
-- precio a propósito: "$---" en la lista)
insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('GASEOSA-COCACOLA-1500', 22350),
  ('GASEOSA-COCACOLA-2250', 30000),
  ('GASEOSA-COCACOLA-3000', 35100),
  ('GASEOSA-SPRITE-1500', 22350),
  ('GASEOSA-SPRITE-2250', 30000),
  ('GASEOSA-SPRITE-3000', 35100),
  ('GASEOSA-SCHWEPPES-1500', 22350),
  ('GASEOSA-SCHWEPPES-2250', 30000),
  ('GASEOSA-AQUARIUS-1500', 18850),
  ('GASEOSA-AQUARIUS-2250', 24400),
  ('GASEOSA-CEPITA-1000-X6', 14000),
  ('GASEOSA-IVESS-500', 6500)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

-- ===========================================================
-- Combos cruzados pendientes (Fernet + Coca-Cola, Gin + Schweppes,
-- Vodka + Sprite). Cada item conserva el precio de lista de su propio
-- SKU; el mixer "dentro del combo" es lo que falta para llegar al total.
-- ===========================================================

select guardar_promocion(null, 'Fernet Branca 750cc + Coca-Cola 2.25L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'FERNET-BRANCA-750'), 'cantidad_requerida', 1, 'precio_promocional', 18850),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-COCACOLA-2250'), 'cantidad_requerida', 1, 'precio_promocional', 2550)
  ));

select guardar_promocion(null, 'Fernet Branca Litro + Coca-Cola 3L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'FERNET-BRANCA-1000'), 'cantidad_requerida', 1, 'precio_promocional', 23850),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-COCACOLA-3000'), 'cantidad_requerida', 1, 'precio_promocional', 3750)
  ));

select guardar_promocion(null, 'Fernet 1882 + Coca-Cola 2.25L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'FERNET-1882-750'), 'cantidad_requerida', 1, 'precio_promocional', 9000),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-COCACOLA-2250'), 'cantidad_requerida', 1, 'precio_promocional', 5400)
  ));

select guardar_promocion(null, 'Fernet Buhero Negro + Coca-Cola 2.25L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'FERNET-BUHERONEGRO-750'), 'cantidad_requerida', 1, 'precio_promocional', 8800),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-COCACOLA-2250'), 'cantidad_requerida', 1, 'precio_promocional', 5500)
  ));

select guardar_promocion(null, 'Fernet 777 + Coca-Cola 2.25L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'FERNET-777-750'), 'cantidad_requerida', 1, 'precio_promocional', 9400),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-COCACOLA-2250'), 'cantidad_requerida', 1, 'precio_promocional', 4800)
  ));

select guardar_promocion(null, 'Merle Clásico + Tónica Schweppes 1.5L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GIN-MERLE-750'), 'cantidad_requerida', 1, 'precio_promocional', 8450),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-SCHWEPPES-1500'), 'cantidad_requerida', 1, 'precio_promocional', 3900)
  ));

select guardar_promocion(null, 'Cordillera London Dry + Tónica Schweppes 1.5L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GIN-CORDILLERA-LD-750'), 'cantidad_requerida', 1, 'precio_promocional', 16700),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-SCHWEPPES-1500'), 'cantidad_requerida', 1, 'precio_promocional', 3900)
  ));

select guardar_promocion(null, 'Burnett''s + Tónica Schweppes 1.5L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GIN-BURNETTS-750'), 'cantidad_requerida', 1, 'precio_promocional', 8000),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-SCHWEPPES-1500'), 'cantidad_requerida', 1, 'precio_promocional', 3900)
  ));

select guardar_promocion(null, 'Skyy Saborizado + Sprite 2.25L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'VODKA-SKYY-SABOR-750'), 'cantidad_requerida', 1, 'precio_promocional', 9400),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-SPRITE-2250'), 'cantidad_requerida', 1, 'precio_promocional', 5400)
  ));

select guardar_promocion(null, 'Smirnoff Clásico + Sprite 2.25L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'VODKA-SMIRNOFF-CLASICO-750'), 'cantidad_requerida', 1, 'precio_promocional', 8150),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-SPRITE-2250'), 'cantidad_requerida', 1, 'precio_promocional', 5450)
  ));

select guardar_promocion(null, 'Smirnoff Saborizado + Sprite 2.25L', 'combo', null, null, null, true,
  jsonb_build_array(
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'VODKA-SMIRNOFF-SABOR-750'), 'cantidad_requerida', 1, 'precio_promocional', 9400),
    jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'GASEOSA-SPRITE-2250'), 'cantidad_requerida', 1, 'precio_promocional', 5400)
  ));

commit;
