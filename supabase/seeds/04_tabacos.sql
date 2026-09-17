-- Carga real de catálogo — categoría TABACO (cuarta tanda).
-- Fuente: lista de precios de Moe, sección "Tabacos".
--
-- Aviso importante: el tabaco se vende por gramos o por paquete, no por
-- volumen líquido -- el esquema original de `skus` solo aceptaba 'ml'/'l'
-- (pensado para bebidas). Eso ya se resolvió en
-- 20260910090000_unidad_volumen_un_gramo.sql, que sumó 'un' (unidad) y
-- 'g' (gramo). Acá se carga tipo_presentacion='unidad' con
-- unidad_volumen='un' (volumen=1) para todo lo que no tiene un peso real
-- conocido en la lista (paquete/lata sin gramaje aclarado) -- el contenido
-- real (marca, sabor, número de línea) queda en el nombre del SKU. Las dos
-- líneas que SÍ traen gramaje en el nombre ("50gr") se corrigen después
-- del insert a unidad_volumen='g' con el peso real.
--
-- Supuestos:
--   1. Cada sabor/número de línea = producto distinto (mismo criterio que
--      el resto del catálogo).
--   2. "Papelillos Lion Rolling Circus Sayri" no es tabaco en sí (son
--      papelillos para armar) pero se cargó en la misma categoría por
--      estar en la misma sección de la lista -- avisame si preferís una
--      categoría "Accesorios" aparte.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Tabaco');

insert into marcas (nombre) values
  ('Argento'), ('Sayri'), ('Red Field'), ('Mac Barren'), ('Manitou'), ('Lion Rolling Circus');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Tabaco')
from (values
  ('Argento Natural #51', 'Argento'),
  ('Argento Manzana #52', 'Argento'),
  ('Argento Negro #53', 'Argento'),
  ('Argento Vainilla #54', 'Argento'),
  ('Argento Chocolate #55', 'Argento'),
  ('Argento Café a la Crema #56', 'Argento'),
  ('Argento Menta #58', 'Argento'),
  ('Argento Uva #59', 'Argento'),
  ('Argento Pipa Vainilla N°1', 'Argento'),
  ('Argento Pipa Natural N°3', 'Argento'),
  ('Argento Pipa Nougat N°5', 'Argento'),
  ('Argento Pipa Layakia N°6', 'Argento'),
  ('Argento Pipa Duo N°7', 'Argento'),
  ('Argento Pipa Edición Limitada Lata Azul', 'Argento'),
  ('Argento Pipa Edición Limitada Lata Negra', 'Argento'),
  ('Sayri Claro', 'Sayri'),
  ('Sayri Amasado Nativo', 'Sayri'),
  ('Sayri Negro', 'Sayri'),
  ('Sayri Mezcla Fuerte', 'Sayri'),
  ('Sayri Mezcla', 'Sayri'),
  ('Red Field Natural', 'Red Field'),
  ('Red Field Vainilla', 'Red Field'),
  ('Red Field Chocolate', 'Red Field'),
  ('Red Field American', 'Red Field'),
  ('Red Field Virginia', 'Red Field'),
  ('Red Field Premium Natural', 'Red Field'),
  ('Mac Barren Original', 'Mac Barren'),
  ('Mac Barren Vainilla', 'Mac Barren'),
  ('Mac Barren Aromatic', 'Mac Barren'),
  ('Mac Barren Manzana', 'Mac Barren'),
  ('Mac Barren Chocolate', 'Mac Barren'),
  ('Mac Barren Doble Vainilla', 'Mac Barren'),
  ('Mac Barren Original Virginia', 'Mac Barren'),
  ('Manitou Virginia Gold', 'Manitou'),
  ('Lion Rolling Circus Sayri (papelillos)', 'Lion Rolling Circus')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

-- volumen=1 / unidad_volumen='un' (ver aviso arriba). El nombre del SKU
-- lleva todo el dato real, salvo las dos líneas con gramaje conocido que
-- se corrigen abajo.
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', 1, 'un', 1
from (values
  ('Argento Natural #51', 'Argento', 'Tabaco Argento Natural #51', 'TABACO-ARGENTO-51'),
  ('Argento Manzana #52', 'Argento', 'Tabaco Argento Manzana #52', 'TABACO-ARGENTO-52'),
  ('Argento Negro #53', 'Argento', 'Tabaco Argento Negro #53', 'TABACO-ARGENTO-53'),
  ('Argento Vainilla #54', 'Argento', 'Tabaco Argento Vainilla #54', 'TABACO-ARGENTO-54'),
  ('Argento Chocolate #55', 'Argento', 'Tabaco Argento Chocolate #55', 'TABACO-ARGENTO-55'),
  ('Argento Café a la Crema #56', 'Argento', 'Tabaco Argento Café a la Crema #56', 'TABACO-ARGENTO-56'),
  ('Argento Menta #58', 'Argento', 'Tabaco Argento Menta #58', 'TABACO-ARGENTO-58'),
  ('Argento Uva #59', 'Argento', 'Tabaco Argento Uva #59', 'TABACO-ARGENTO-59'),
  ('Argento Pipa Vainilla N°1', 'Argento', 'Tabaco Argento Pipa Vainilla N°1', 'TABACO-ARGENTO-PIPA-1'),
  ('Argento Pipa Natural N°3', 'Argento', 'Tabaco Argento Pipa Natural N°3', 'TABACO-ARGENTO-PIPA-3'),
  ('Argento Pipa Nougat N°5', 'Argento', 'Tabaco Argento Pipa Nougat N°5', 'TABACO-ARGENTO-PIPA-5'),
  ('Argento Pipa Layakia N°6', 'Argento', 'Tabaco Argento Pipa Layakia N°6', 'TABACO-ARGENTO-PIPA-6'),
  ('Argento Pipa Duo N°7', 'Argento', 'Tabaco Argento Pipa Duo N°7', 'TABACO-ARGENTO-PIPA-7'),
  ('Argento Pipa Edición Limitada Lata Azul', 'Argento', 'Tabaco Argento Pipa Edición Limitada Lata Azul 50gr', 'TABACO-ARGENTO-PIPA-EL-AZUL'),
  ('Argento Pipa Edición Limitada Lata Negra', 'Argento', 'Tabaco Argento Pipa Edición Limitada Lata Negra 50gr', 'TABACO-ARGENTO-PIPA-EL-NEGRA'),
  ('Sayri Claro', 'Sayri', 'Tabaco Sayri Claro', 'TABACO-SAYRI-CLARO'),
  ('Sayri Amasado Nativo', 'Sayri', 'Tabaco Sayri Amasado Nativo', 'TABACO-SAYRI-AMASADO'),
  ('Sayri Negro', 'Sayri', 'Tabaco Sayri Negro', 'TABACO-SAYRI-NEGRO'),
  ('Sayri Mezcla Fuerte', 'Sayri', 'Tabaco Sayri Mezcla Fuerte', 'TABACO-SAYRI-MEZCLAFUERTE'),
  ('Sayri Mezcla', 'Sayri', 'Tabaco Sayri Mezcla', 'TABACO-SAYRI-MEZCLA'),
  ('Red Field Natural', 'Red Field', 'Tabaco Red Field 1 Natural', 'TABACO-REDFIELD-1'),
  ('Red Field Vainilla', 'Red Field', 'Tabaco Red Field 2 Vainilla', 'TABACO-REDFIELD-2'),
  ('Red Field Chocolate', 'Red Field', 'Tabaco Red Field 3 Chocolate', 'TABACO-REDFIELD-3'),
  ('Red Field American', 'Red Field', 'Tabaco Red Field 4 American', 'TABACO-REDFIELD-4'),
  ('Red Field Virginia', 'Red Field', 'Tabaco Red Field 12 Virginia', 'TABACO-REDFIELD-12'),
  ('Red Field Premium Natural', 'Red Field', 'Tabaco Red Field 14 Premium Natural', 'TABACO-REDFIELD-14'),
  ('Mac Barren Original', 'Mac Barren', 'Tabaco Mac Barren #01 Original', 'TABACO-MACBARREN-01'),
  ('Mac Barren Vainilla', 'Mac Barren', 'Tabaco Mac Barren #02 Vainilla', 'TABACO-MACBARREN-02'),
  ('Mac Barren Aromatic', 'Mac Barren', 'Tabaco Mac Barren #05 Aromatic', 'TABACO-MACBARREN-05'),
  ('Mac Barren Manzana', 'Mac Barren', 'Tabaco Mac Barren #12 Manzana', 'TABACO-MACBARREN-12'),
  ('Mac Barren Chocolate', 'Mac Barren', 'Tabaco Mac Barren #16 Chocolate', 'TABACO-MACBARREN-16'),
  ('Mac Barren Doble Vainilla', 'Mac Barren', 'Tabaco Mac Barren #225 Doble Vainilla', 'TABACO-MACBARREN-225'),
  ('Mac Barren Original Virginia', 'Mac Barren', 'Tabaco Mac Barren Original Virginia', 'TABACO-MACBARREN-ORIGVIRGINIA'),
  ('Manitou Virginia Gold', 'Manitou', 'Tabaco Manitou Virginia Gold', 'TABACO-MANITOU-VIRGINIAGOLD'),
  ('Lion Rolling Circus Sayri (papelillos)', 'Lion Rolling Circus', 'Papelillos Lion Rolling Circus Sayri', 'PAPELILLOS-LRC-SAYRI')
) as v(producto, marca, nombre_sku, codigo)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

-- Las dos únicas líneas de esta tanda con gramaje real conocido ("50gr" en
-- el nombre de la lista) -- se corrigen a 'g' en vez de quedar en 'un'.
update skus set volumen = 50, unidad_volumen = 'g'
where codigo_interno in ('TABACO-ARGENTO-PIPA-EL-AZUL', 'TABACO-ARGENTO-PIPA-EL-NEGRA');

insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('TABACO-ARGENTO-51', 5700),
  ('TABACO-ARGENTO-52', 5700),
  ('TABACO-ARGENTO-53', 5700),
  ('TABACO-ARGENTO-54', 5700),
  ('TABACO-ARGENTO-55', 5700),
  ('TABACO-ARGENTO-56', 5700),
  ('TABACO-ARGENTO-58', 5700),
  ('TABACO-ARGENTO-59', 5700),
  ('TABACO-ARGENTO-PIPA-1', 7500),
  ('TABACO-ARGENTO-PIPA-3', 7500),
  ('TABACO-ARGENTO-PIPA-5', 7500),
  ('TABACO-ARGENTO-PIPA-6', 7500),
  ('TABACO-ARGENTO-PIPA-7', 8500),
  ('TABACO-ARGENTO-PIPA-EL-AZUL', 12400),
  ('TABACO-ARGENTO-PIPA-EL-NEGRA', 12400),
  ('TABACO-SAYRI-CLARO', 6200),
  ('TABACO-SAYRI-AMASADO', 7200),
  ('TABACO-SAYRI-NEGRO', 7200),
  ('TABACO-SAYRI-MEZCLAFUERTE', 7200),
  ('TABACO-SAYRI-MEZCLA', 7200),
  ('TABACO-REDFIELD-1', 7300),
  ('TABACO-REDFIELD-2', 7300),
  ('TABACO-REDFIELD-3', 6800),
  ('TABACO-REDFIELD-4', 6800),
  ('TABACO-REDFIELD-12', 6800),
  ('TABACO-REDFIELD-14', 7300),
  ('TABACO-MACBARREN-01', 7300),
  ('TABACO-MACBARREN-02', 7300),
  ('TABACO-MACBARREN-05', 7300),
  ('TABACO-MACBARREN-12', 7300),
  ('TABACO-MACBARREN-16', 7300),
  ('TABACO-MACBARREN-225', 7300),
  ('TABACO-MACBARREN-ORIGVIRGINIA', 7300),
  ('TABACO-MANITOU-VIRGINIAGOLD', 5700),
  ('PAPELILLOS-LRC-SAYRI', 500)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

commit;
