-- Carga real de catálogo — CERVEZA RETORNABLE (quinta tanda).
-- Fuente: lista de precios de Moe, sección "Cervezas Retornables".
--
-- Confirmado con el usuario:
--   1. Envase único genérico "Litro Retornable" compartido entre todas
--      las marcas (no uno por marca).
--   2. valor_deposito = 0 por ahora -- la lista no trae el monto real del
--      depósito. Ajustar desde /envases cuando se sepa.
--
-- Supuestos:
--   3. Botella de 1 litro para todas las marcas -- la lista no aclara el
--      tamaño, es el formato retornable estándar en Argentina.
--   4. "Valores de cajones": cantidad de botellas por cajón NO está en la
--      lista. Se cargó unidades_contenidas=12 como PLACEHOLDER (afecta el
--      recargo de Laprida, que se multiplica por unidades_contenidas —
--      confirmar el número real antes de vender cajones en Laprida).

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Cerveza');

insert into tipos_envase (nombre, es_generico, valor_deposito)
values ('Litro Retornable', true, 0);

insert into marcas (nombre) values
  ('Andes'), ('Quilmes'), ('Imperial'), ('Heineken'), ('Amstel'),
  ('Budweiser'), ('Brahma'), ('Stella Artois');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Cerveza')
from (values
  ('Andes', 'Andes'),
  ('Quilmes Clásica', 'Quilmes'),
  ('Imperial Lager', 'Imperial'),
  ('Imperial Golden', 'Imperial'),
  ('Imperial Ipa', 'Imperial'),
  ('Heineken', 'Heineken'),
  ('Amstel', 'Amstel'),
  ('Budweiser', 'Budweiser'),
  ('Brahma', 'Brahma'),
  ('Stella Artois', 'Stella Artois')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (
  producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen,
  unidades_contenidas, es_retornable, tipo_envase_id
)
select p.id, v.nombre_sku, v.codigo, v.tipo, v.volumen, 'ml', v.unidades,
  true, (select id from tipos_envase where nombre = 'Litro Retornable')
from (values
  ('Andes', 'Andes', 'Andes Retornable 1L', 'CERVEZA-RETORNABLE-ANDES-1000', 'unidad', 1000, 1),
  ('Andes', 'Andes', 'Andes Cajón', 'CERVEZA-RETORNABLE-ANDES-CAJON', 'cajon', 1000, 12),
  ('Quilmes Clásica', 'Quilmes', 'Quilmes Clásica Retornable 1L', 'CERVEZA-RETORNABLE-QUILMES-1000', 'unidad', 1000, 1),
  ('Quilmes Clásica', 'Quilmes', 'Quilmes Clásica Cajón', 'CERVEZA-RETORNABLE-QUILMES-CAJON', 'cajon', 1000, 12),
  ('Imperial Lager', 'Imperial', 'Imperial Lager Retornable 1L', 'CERVEZA-RETORNABLE-IMPLAGER-1000', 'unidad', 1000, 1),
  ('Imperial Lager', 'Imperial', 'Imperial Lager Cajón', 'CERVEZA-RETORNABLE-IMPLAGER-CAJON', 'cajon', 1000, 12),
  ('Imperial Golden', 'Imperial', 'Imperial Golden Retornable 1L', 'CERVEZA-RETORNABLE-IMPGOLDEN-1000', 'unidad', 1000, 1),
  ('Imperial Golden', 'Imperial', 'Imperial Golden Cajón', 'CERVEZA-RETORNABLE-IMPGOLDEN-CAJON', 'cajon', 1000, 12),
  ('Imperial Ipa', 'Imperial', 'Imperial Ipa Retornable 1L', 'CERVEZA-RETORNABLE-IMPIPA-1000', 'unidad', 1000, 1),
  ('Imperial Ipa', 'Imperial', 'Imperial Ipa Cajón', 'CERVEZA-RETORNABLE-IMPIPA-CAJON', 'cajon', 1000, 12),
  ('Heineken', 'Heineken', 'Heineken Retornable 1L', 'CERVEZA-RETORNABLE-HEINEKEN-1000', 'unidad', 1000, 1),
  ('Heineken', 'Heineken', 'Heineken Cajón', 'CERVEZA-RETORNABLE-HEINEKEN-CAJON', 'cajon', 1000, 12),
  ('Amstel', 'Amstel', 'Amstel Retornable 1L', 'CERVEZA-RETORNABLE-AMSTEL-1000', 'unidad', 1000, 1),
  ('Amstel', 'Amstel', 'Amstel Cajón', 'CERVEZA-RETORNABLE-AMSTEL-CAJON', 'cajon', 1000, 12),
  ('Budweiser', 'Budweiser', 'Budweiser Retornable 1L', 'CERVEZA-RETORNABLE-BUDWEISER-1000', 'unidad', 1000, 1),
  ('Budweiser', 'Budweiser', 'Budweiser Cajón', 'CERVEZA-RETORNABLE-BUDWEISER-CAJON', 'cajon', 1000, 12),
  ('Brahma', 'Brahma', 'Brahma Retornable 1L', 'CERVEZA-RETORNABLE-BRAHMA-1000', 'unidad', 1000, 1),
  ('Brahma', 'Brahma', 'Brahma Cajón', 'CERVEZA-RETORNABLE-BRAHMA-CAJON', 'cajon', 1000, 12),
  ('Stella Artois', 'Stella Artois', 'Stella Artois Retornable 1L', 'CERVEZA-RETORNABLE-STELLA-1000', 'unidad', 1000, 1),
  ('Stella Artois', 'Stella Artois', 'Stella Artois Cajón', 'CERVEZA-RETORNABLE-STELLA-CAJON', 'cajon', 1000, 12)
) as v(producto, marca, nombre_sku, codigo, tipo, volumen, unidades)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('CERVEZA-RETORNABLE-ANDES-1000', 4700),
  ('CERVEZA-RETORNABLE-ANDES-CAJON', 51700),
  ('CERVEZA-RETORNABLE-QUILMES-1000', 4000),
  ('CERVEZA-RETORNABLE-QUILMES-CAJON', 44500),
  ('CERVEZA-RETORNABLE-IMPLAGER-1000', 4400),
  ('CERVEZA-RETORNABLE-IMPLAGER-CAJON', 48100),
  ('CERVEZA-RETORNABLE-IMPGOLDEN-1000', 4700),
  ('CERVEZA-RETORNABLE-IMPGOLDEN-CAJON', 51200),
  ('CERVEZA-RETORNABLE-IMPIPA-1000', 4800),
  ('CERVEZA-RETORNABLE-IMPIPA-CAJON', 52750),
  ('CERVEZA-RETORNABLE-HEINEKEN-1000', 5600),
  ('CERVEZA-RETORNABLE-HEINEKEN-CAJON', 60100),
  ('CERVEZA-RETORNABLE-AMSTEL-1000', 4400),
  ('CERVEZA-RETORNABLE-AMSTEL-CAJON', 48500),
  ('CERVEZA-RETORNABLE-BUDWEISER-1000', 4400),
  ('CERVEZA-RETORNABLE-BUDWEISER-CAJON', 48800),
  ('CERVEZA-RETORNABLE-BRAHMA-1000', 3800),
  ('CERVEZA-RETORNABLE-BRAHMA-CAJON', 41900),
  ('CERVEZA-RETORNABLE-STELLA-1000', 6200),
  ('CERVEZA-RETORNABLE-STELLA-CAJON', 68600)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

-- Promos 2x (100% cerveza retornable, no dependen de otra categoria)
select guardar_promocion(null, 'Andes 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-ANDES-1000'), 'cantidad_requerida', 2, 'precio_promocional', 8700)));
select guardar_promocion(null, 'Quilmes Clásica 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-QUILMES-1000'), 'cantidad_requerida', 2, 'precio_promocional', 7500)));
select guardar_promocion(null, 'Imperial Lager 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-IMPLAGER-1000'), 'cantidad_requerida', 2, 'precio_promocional', 8100)));
select guardar_promocion(null, 'Imperial Golden 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-IMPGOLDEN-1000'), 'cantidad_requerida', 2, 'precio_promocional', 8600)));
select guardar_promocion(null, 'Imperial Ipa 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-IMPIPA-1000'), 'cantidad_requerida', 2, 'precio_promocional', 8800)));
select guardar_promocion(null, 'Heineken 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-HEINEKEN-1000'), 'cantidad_requerida', 2, 'precio_promocional', 10100)));
select guardar_promocion(null, 'Amstel 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-AMSTEL-1000'), 'cantidad_requerida', 2, 'precio_promocional', 8100)));
select guardar_promocion(null, 'Budweiser 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-BUDWEISER-1000'), 'cantidad_requerida', 2, 'precio_promocional', 8200)));
select guardar_promocion(null, 'Brahma 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-BRAHMA-1000'), 'cantidad_requerida', 2, 'precio_promocional', 7000)));
select guardar_promocion(null, 'Stella Artois 2x', 'cantidad', null, null, null, true,
  jsonb_build_array(jsonb_build_object('sku_id', (select id from skus where codigo_interno = 'CERVEZA-RETORNABLE-STELLA-1000'), 'cantidad_requerida', 2, 'precio_promocional', 11500)));

commit;
