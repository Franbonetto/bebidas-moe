-- Carga real de catálogo + precios de Laprida — sección "OTROS" +
-- "FRUTOS SECOS" de la lista de Laprida (12/09/26), más los overrides de
-- la sección "THE MULA" (que sí ya existía, 08_the_mula.sql).
--
-- Los snacks (Lay's, maní, aceitunas, frutos secos, mixes) se venden por
-- peso/unidad de bolsa, no por volumen líquido, y la lista no aclara
-- gramaje -- se cargan con unidad_volumen='un' (volumen=1), mismo criterio
-- que el tabaco en 04_tabacos.sql. Pringles es la única excepción: la
-- lista SÍ trae el gramaje ("105g") en el nombre, así que va con
-- unidad_volumen='g' y volumen=105. El aceite de oliva y el aceto sí son
-- líquidos, esos llevan volumen real en ml.
--
-- "The mula porrón cocina $1.650" es un precio muy por debajo del resto
-- de la línea The Mula (todas $5.200-$6.900 en 1L) -- asumí que es una
-- presentación más chica tipo porrón (330cc) de la misma marca, no una
-- corrección de precio de las que ya existen. Revisar en /productos.
--
-- Ningún producto de esta sección existía en el catálogo -- todo alta
-- nueva en Olavarría sin precio, con el override de Laprida.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Otros');

insert into marcas (nombre) values
  ('Aceite de Oliva'), ('Milán'), ('Lay''s'), ('Pringles'), ('Maní'),
  ('Aceituna'), ('Frutos Secos'), ('Mix');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Otros')
from (values
  ('Aceite de Oliva', 'Aceite de Oliva'),
  ('Aceto Milán Verde', 'Milán'),
  ('Aceto Milán Rojo', 'Milán'),
  ('Aceto Milán Blanco', 'Milán'),
  ('Lay''s', 'Lay''s'),
  ('Maní Cáscara', 'Maní'),
  ('Maní Mix Vaso', 'Maní'),
  ('Aceituna Verde Grande', 'Aceituna'),
  ('Aceituna Verde Chica', 'Aceituna'),
  ('Aceituna Naranja', 'Aceituna'),
  ('Aceituna Rosa', 'Aceituna'),
  ('Arándanos', 'Frutos Secos'),
  ('Banana', 'Frutos Secos'),
  ('Almendras', 'Frutos Secos'),
  ('Castañas Cajú', 'Frutos Secos'),
  ('Mix Energético', 'Mix'),
  ('Mix Happy', 'Mix'),
  ('Mix Premium', 'Mix'),
  ('Mix Caribe sin Maní', 'Mix'),
  ('Pringles', 'Pringles')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

-- The Mula Porrón Cocina: producto nuevo bajo la marca ya existente
-- (08_the_mula.sql), categoría Otros (así está agrupado en la lista).
insert into productos (nombre, marca_id, categoria_id)
select 'The Mula Porrón Cocina', (select id from marcas where nombre = 'The Mula'),
  (select id from categorias where nombre = 'Otros');

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, v.unidad, 1
from (values
  ('Aceite de Oliva', 'Aceite de Oliva 2L', 'OTROS-ACEITEOLIVA-2000', 2000, 'ml'),
  ('Aceite de Oliva', 'Aceite de Oliva 1L', 'OTROS-ACEITEOLIVA-1000', 1000, 'ml'),
  ('Aceite de Oliva', 'Aceite de Oliva 1/2L', 'OTROS-ACEITEOLIVA-500', 500, 'ml'),
  ('Aceto Milán Verde', 'Aceto Milán Verde 500cc', 'OTROS-ACETOMILAN-VERDE-500', 500, 'ml'),
  ('Aceto Milán Rojo', 'Aceto Milán Rojo 500cc', 'OTROS-ACETOMILAN-ROJO-500', 500, 'ml'),
  ('Aceto Milán Blanco', 'Aceto Milán Blanco 500cc', 'OTROS-ACETOMILAN-BLANCO-500', 500, 'ml'),
  ('The Mula Porrón Cocina', 'The Mula Porrón Cocina 330cc', 'OTROS-THEMULA-PORRONCOCINA-330', 330, 'ml'),
  ('Lay''s', 'Lay''s', 'OTROS-LAYS-UN', 1, 'un'),
  ('Maní Cáscara', 'Maní Cáscara', 'OTROS-MANI-CASCARA-UN', 1, 'un'),
  ('Maní Mix Vaso', 'Maní Mix Vaso', 'OTROS-MANI-MIXVASO-UN', 1, 'un'),
  ('Aceituna Verde Grande', 'Aceituna Verde Grande', 'OTROS-ACEITUNA-VERDEGRANDE-UN', 1, 'un'),
  ('Aceituna Verde Chica', 'Aceituna Verde Chica', 'OTROS-ACEITUNA-VERDECHICA-UN', 1, 'un'),
  ('Aceituna Naranja', 'Aceituna Naranja', 'OTROS-ACEITUNA-NARANJA-UN', 1, 'un'),
  ('Aceituna Rosa', 'Aceituna Rosa', 'OTROS-ACEITUNA-ROSA-UN', 1, 'un'),
  ('Arándanos', 'Arándanos', 'OTROS-ARANDANOS-UN', 1, 'un'),
  ('Banana', 'Banana', 'OTROS-BANANA-UN', 1, 'un'),
  ('Almendras', 'Almendras', 'OTROS-ALMENDRAS-UN', 1, 'un'),
  ('Castañas Cajú', 'Castañas Cajú', 'OTROS-CASTANASCAJU-UN', 1, 'un'),
  ('Mix Energético', 'Mix Energético', 'OTROS-MIX-ENERGETICO-UN', 1, 'un'),
  ('Mix Happy', 'Mix Happy', 'OTROS-MIX-HAPPY-UN', 1, 'un'),
  ('Mix Premium', 'Mix Premium', 'OTROS-MIX-PREMIUM-UN', 1, 'un'),
  ('Mix Caribe sin Maní', 'Mix Caribe sin Maní', 'OTROS-MIX-CARIBESINMANI-UN', 1, 'un'),
  ('Pringles', 'Pringles 105g', 'OTROS-PRINGLES-105-UN', 105, 'g')
) as v(producto, nombre_sku, codigo, volumen, unidad)
join productos p on p.nombre = v.producto
  and p.categoria_id = (select id from categorias where nombre = 'Otros');

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('OTROS-ACEITEOLIVA-2000', 50000),
  ('OTROS-ACEITEOLIVA-1000', 27000),
  ('OTROS-ACEITEOLIVA-500', 14000),
  ('OTROS-ACETOMILAN-VERDE-500', 6600),
  ('OTROS-ACETOMILAN-ROJO-500', 5800),
  ('OTROS-ACETOMILAN-BLANCO-500', 6600),
  ('OTROS-THEMULA-PORRONCOCINA-330', 1650),
  ('OTROS-LAYS-UN', 4500),
  ('OTROS-MANI-CASCARA-UN', 4000),
  ('OTROS-MANI-MIXVASO-UN', 4000),
  ('OTROS-ACEITUNA-VERDEGRANDE-UN', 7350),
  ('OTROS-ACEITUNA-VERDECHICA-UN', 4000),
  ('OTROS-ACEITUNA-NARANJA-UN', 4350),
  ('OTROS-ACEITUNA-ROSA-UN', 4750),
  ('OTROS-ARANDANOS-UN', 5000),
  ('OTROS-BANANA-UN', 2700),
  ('OTROS-ALMENDRAS-UN', 5000),
  ('OTROS-CASTANASCAJU-UN', 4000),
  ('OTROS-MIX-ENERGETICO-UN', 4600),
  ('OTROS-MIX-HAPPY-UN', 4000),
  ('OTROS-MIX-PREMIUM-UN', 8500),
  ('OTROS-MIX-CARIBESINMANI-UN', 5200),
  ('OTROS-PRINGLES-105-UN', 5000),
  -- Overrides sobre The Mula (08_the_mula.sql), sección "THE MULA" de la
  -- lista de Laprida -- coinciden exacto con el precio_base de Olavarría.
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
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
