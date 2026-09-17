-- Carga real de catálogo — categoría VODKA (tercera tanda).
-- Fuente: lista de precios de Moe, sección "Vodkas".
--
-- Supuestos / pendientes:
--
--   1. "Skyy/Smirnoff clásico" y "Skyy/Smirnoff saborizado" se cargaron
--      como PRODUCTOS distintos bajo la misma marca (arquitectura.md 1.3:
--      sabor/variedad = producto distinto), aunque "saborizado" no
--      especifique de qué sabor se trata -- así está en la lista.
--   2. Volumen no aclarado => 750 ml, salvo Absolut que dice "700cc"
--      explícito.
--   3. Ninguna promo de Vodka es 100% vodka: todas son combos con jugo o
--      Sprite (ej. "Sernova + 1 jugo $10.900"), así que quedan afuera de
--      esta tanda por la misma razón que los combos de Fernet -- "jugo"
--      ni "Sprite" existen todavía como SKU (van en Gaseosas). El único
--      candidato es "Cepita 1L x6" de la lista de Gaseosas, pero no queda
--      claro si es el "jugo" genérico de estos combos -- lo confirmo
--      cuando cargue esa tanda.
--   4. "CocoBongo + 1 jugo $10.150" (ron de coco) aparece mezclado en
--      esta sección pero es otra categoría (Ron) y no tiene precio base
--      propio en ningún lado de la lista -- NO se cargó. Si tenés el
--      precio de CocoBongo solo, lo sumo en una tanda de Ron.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Vodka');

insert into marcas (nombre) values
  ('Sernova'), ('Skyy'), ('Smirnoff'), ('Absolut'), ('Grey Goose'), ('Ciroc'), ('Danzka');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Vodka')
from (values
  ('Sernova', 'Sernova'),
  ('Skyy Saborizado', 'Skyy'),
  ('Skyy Clásico', 'Skyy'),
  ('Smirnoff Clásico', 'Smirnoff'),
  ('Smirnoff Saborizado', 'Smirnoff'),
  ('Absolut', 'Absolut'),
  ('Grey Goose', 'Grey Goose'),
  ('Ciroc', 'Ciroc'),
  ('Danzka', 'Danzka')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('Sernova', 'Sernova', 'Sernova 750cc', 'VODKA-SERNOVA-750', 750),
  ('Skyy Saborizado', 'Skyy', 'Skyy Saborizado 750cc', 'VODKA-SKYY-SABOR-750', 750),
  ('Skyy Clásico', 'Skyy', 'Skyy Clásico 750cc', 'VODKA-SKYY-CLASICO-750', 750),
  ('Smirnoff Clásico', 'Smirnoff', 'Smirnoff Clásico 750cc', 'VODKA-SMIRNOFF-CLASICO-750', 750),
  ('Smirnoff Saborizado', 'Smirnoff', 'Smirnoff Saborizado 750cc', 'VODKA-SMIRNOFF-SABOR-750', 750),
  ('Absolut', 'Absolut', 'Absolut 700cc', 'VODKA-ABSOLUT-700', 700),
  ('Grey Goose', 'Grey Goose', 'Grey Goose 750cc', 'VODKA-GREYGOOSE-750', 750),
  ('Ciroc', 'Ciroc', 'Ciroc 750cc', 'VODKA-CIROC-750', 750),
  ('Danzka', 'Danzka', 'Danzka 750cc', 'VODKA-DANZKA-750', 750)
) as v(producto, marca, nombre_sku, codigo, volumen)
join marcas m on m.nombre = v.marca
join productos p on p.marca_id = m.id and p.nombre = v.producto;

insert into precios (sku_id, precio_base)
select s.id, v.precio
from (values
  ('VODKA-SERNOVA-750', 8250),
  ('VODKA-SKYY-SABOR-750', 9400),
  ('VODKA-SKYY-CLASICO-750', 8550),
  ('VODKA-SMIRNOFF-CLASICO-750', 8150),
  ('VODKA-SMIRNOFF-SABOR-750', 9400),
  ('VODKA-ABSOLUT-700', 30800),
  ('VODKA-GREYGOOSE-750', 67900),
  ('VODKA-CIROC-750', 70000),
  ('VODKA-DANZKA-750', 35000)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo;

commit;
