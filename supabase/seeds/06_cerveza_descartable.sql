-- Carga real de catálogo — CERVEZA DESCARTABLE (sexta tanda).
-- Fuente: lista de precios de Moe, sección "Cervezas Descartables"
-- (porrones 330cc + Miller 600cc).
--
-- Reusa marcas/productos "Heineken" e "Imperial Golden" de la tanda
-- anterior (05_cerveza_retornable.sql) -- son la misma cerveza, distinto
-- envase (porrón descartable en vez de retornable), así que van como SKU
-- nuevo del mismo producto, no un producto aparte. Por eso NO se vuelve a
-- insertar esas marcas/productos acá.
--
-- Supuestos:
--   1. Los porrones NO son retornables (es_retornable=false) -- son de un
--      solo uso, a diferencia de la sección anterior.
--   2. El pack x6 de porrones queda como SKU plano, SIN relación de
--      desarme hacia la unidad -- la cascada x24→x6→unidad que pediste
--      es específicamente para las latas (próxima tanda), esta sección
--      no menciona un nivel x24 para porrones.
--   3. "Miller 600cc" es un tamaño distinto del mismo producto "Miller"
--      (no un producto aparte). Su "2x$7.800" es una promoción, no un SKU
--      nuevo.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values ('Miller'), ('Corona');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Cerveza')
from (values
  ('Miller', 'Miller'),
  ('Corona', 'Corona'),
  ('Heineken Sin Alcohol', 'Heineken'),
  ('Stella Artois Sin Alcohol', 'Stella Artois')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, es_retornable)
select p.id, v.nombre_sku, v.codigo, v.tipo, v.volumen, 'ml', v.unidades, false
from (values
  ('Miller', 'Miller', 'Miller Porrón 330cc', 'CERVEZA-DESC-MILLER-330', 'unidad', 330, 1),
  ('Miller', 'Miller', 'Miller Pack x6 330cc', 'CERVEZA-DESC-MILLER-330-X6', 'pack', 330, 6),
  ('Miller', 'Miller', 'Miller 600cc', 'CERVEZA-DESC-MILLER-600', 'unidad', 600, 1),
  ('Corona', 'Corona', 'Corona Porrón 330cc', 'CERVEZA-DESC-CORONA-330', 'unidad', 330, 1),
  ('Corona', 'Corona', 'Corona Pack x6 330cc', 'CERVEZA-DESC-CORONA-330-X6', 'pack', 330, 6),
  ('Heineken', 'Heineken', 'Heineken Porrón 330cc', 'CERVEZA-DESC-HEINEKEN-330', 'unidad', 330, 1),
  ('Heineken', 'Heineken', 'Heineken Pack x6 330cc', 'CERVEZA-DESC-HEINEKEN-330-X6', 'pack', 330, 6),
  ('Heineken Sin Alcohol', 'Heineken', 'Heineken Sin Alcohol Porrón 330cc', 'CERVEZA-DESC-HEINEKEN0-330', 'unidad', 330, 1),
  ('Heineken Sin Alcohol', 'Heineken', 'Heineken Sin Alcohol Pack x6 330cc', 'CERVEZA-DESC-HEINEKEN0-330-X6', 'pack', 330, 6),
  ('Imperial Golden', 'Imperial', 'Imperial Golden Porrón 330cc', 'CERVEZA-DESC-IMPGOLDEN-330', 'unidad', 330, 1),
  ('Imperial Golden', 'Imperial', 'Imperial Golden Pack x6 330cc', 'CERVEZA-DESC-IMPGOLDEN-330-X6', 'pack', 330, 6),
  ('Stella Artois Sin Alcohol', 'Stella Artois', 'Stella Artois Sin Alcohol Porrón 330cc', 'CERVEZA-DESC-STELLA0-330', 'unidad', 330, 1)
) as v(producto, marca, nombre_sku, codigo, tipo, volumen, unidades)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('CERVEZA-DESC-MILLER-330', 2500),
  ('CERVEZA-DESC-MILLER-330-X6', 14150),
  ('CERVEZA-DESC-MILLER-600', 4300),
  ('CERVEZA-DESC-CORONA-330', 2600),
  ('CERVEZA-DESC-CORONA-330-X6', 15300),
  ('CERVEZA-DESC-HEINEKEN-330', 2850),
  ('CERVEZA-DESC-HEINEKEN-330-X6', 16600),
  ('CERVEZA-DESC-HEINEKEN0-330', 2400),
  ('CERVEZA-DESC-HEINEKEN0-330-X6', 13900),
  ('CERVEZA-DESC-IMPGOLDEN-330', 2500),
  ('CERVEZA-DESC-IMPGOLDEN-330-X6', 14200),
  ('CERVEZA-DESC-STELLA0-330', 1800)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

-- Promo 2x (Miller 600cc, unica 100% autonoma de esta seccion)
select guardar_promocion(null, 'Miller 600cc 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object(
    'sku_id', (select id from skus where codigo_interno = 'CERVEZA-DESC-MILLER-600'),
    'cantidad_requerida', 2,
    'precio_promocional', 7800
  )));

commit;
