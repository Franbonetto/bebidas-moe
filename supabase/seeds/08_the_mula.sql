-- Carga real de catálogo — THE MULA, cervezas artesanales (octava tanda).
-- Fuente: lista de precios de Moe, sección "The Mula Cervezas
-- Artesanales descartables 1Lts".
--
-- La promo "3 botellas $16.800: 1 Doble Ipa + 1 Ipa o Apa + 1 Clásica a
-- elección" NO se cargó: es literalmente el caso "combo con opciones a
-- elección" que docs/arquitectura.md ya marca como postergado a
-- propósito (el motor de promociones no soporta grupos de opciones
-- todavía, arquitectura.md 3.4, caso 1). Se carga a mano en el ticket
-- ajustando precios hasta que se construya esa pieza.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values ('The Mula');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, (select id from marcas where nombre = 'The Mula'), (select id from categorias where nombre = 'Cerveza')
from (values
  ('The Mula Doble Ipa'),
  ('The Mula Ipa'),
  ('The Mula Apa'),
  ('The Mula Clásica Honey'),
  ('The Mula Clásica Wheat'),
  ('The Mula Clásica Golden'),
  ('The Mula Clásica Amber'),
  ('The Mula Clásica Scotch'),
  ('The Mula Clásica Stout')
) as v(nombre);

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, es_retornable)
select p.id, v.nombre_sku, v.codigo, 'unidad', 1000, 'ml', 1, false
from (values
  ('The Mula Doble Ipa', 'The Mula Doble Ipa 1L', 'CERVEZA-THEMULA-DOBLEIPA-1000'),
  ('The Mula Ipa', 'The Mula Ipa 1L', 'CERVEZA-THEMULA-IPA-1000'),
  ('The Mula Apa', 'The Mula Apa 1L', 'CERVEZA-THEMULA-APA-1000'),
  ('The Mula Clásica Honey', 'The Mula Clásica Honey 1L', 'CERVEZA-THEMULA-HONEY-1000'),
  ('The Mula Clásica Wheat', 'The Mula Clásica Wheat 1L', 'CERVEZA-THEMULA-WHEAT-1000'),
  ('The Mula Clásica Golden', 'The Mula Clásica Golden 1L', 'CERVEZA-THEMULA-GOLDEN-1000'),
  ('The Mula Clásica Amber', 'The Mula Clásica Amber 1L', 'CERVEZA-THEMULA-AMBER-1000'),
  ('The Mula Clásica Scotch', 'The Mula Clásica Scotch 1L', 'CERVEZA-THEMULA-SCOTCH-1000'),
  ('The Mula Clásica Stout', 'The Mula Clásica Stout 1L', 'CERVEZA-THEMULA-STOUT-1000')
) as v(producto, nombre_sku, codigo)
join productos p on p.nombre = v.producto;

insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('CERVEZA-THEMULA-DOBLEIPA-1000', 6900),
  ('CERVEZA-THEMULA-IPA-1000', 6100),
  ('CERVEZA-THEMULA-APA-1000', 6100),
  ('CERVEZA-THEMULA-HONEY-1000', 5200),
  ('CERVEZA-THEMULA-WHEAT-1000', 5200),
  ('CERVEZA-THEMULA-GOLDEN-1000', 5200),
  ('CERVEZA-THEMULA-AMBER-1000', 5200),
  ('CERVEZA-THEMULA-SCOTCH-1000', 5200),
  ('CERVEZA-THEMULA-STOUT-1000', 5200)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

commit;
