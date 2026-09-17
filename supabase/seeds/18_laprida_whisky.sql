-- Carga real de catálogo + precios de Laprida — sección "WHISKY" (lista de
-- precios de Laprida, 12/09/26). Mismo criterio que las tandas anteriores:
-- override sobre SKU existente cuando el nombre matchea con 09_whisky.sql,
-- alta nueva cuando no existe.
--
-- Casos particulares:
--   - "White & Mackay â sin precio anotado": es la misma marca que ya
--     existe como "Whyte y Mackay" (WHISKY-WHYTEMACKAY-750) -- variante de
--     transliteración del mismo whisky escocés. Como la lista de Laprida
--     no le puso precio, NO se carga ningún override (igual que Johnnie
--     Walker Red Label Litro y Balletines Litro en 09_whisky.sql).
--   - "Cardhu â $128.500": es la ortografía correcta de la marca que en
--     09_whisky.sql había quedado cargada como "Cardu" (typo). Precio
--     casi idéntico ($127.500 en Olavarría) confirma que es el mismo
--     producto -- se agrega el override ahí, NO se crea una marca
--     "Cardhu" separada. Si se quiere corregir el typo de la marca, es un
--     UPDATE aparte sobre `marcas`, no algo para hacer desde un seed de
--     precios.
--   - "Johnnie Walker Blue Label 1 L â $420.000": la lista dice "1 L" pero
--     el catálogo solo tiene el Blue Label en 750cc (base $418.000, casi
--     idéntico a este precio). Un litro de Blue Label debería costar
--     bastante más que el 750cc, así que asumí que es un error de la
--     planilla de Laprida (volumen mal copiado) y cargué el override
--     sobre el SKU de 750cc existente. Si en Laprida realmente venden un
--     litro aparte, avisame para darlo de alta como SKU nuevo.
--   - "Grant's â $31500": el catálogo tiene Grant's Litro ($30.500) y
--     Grant's 750cc ($30.600), casi al mismo precio en Olavarría -- no hay
--     forma de saber cuál es. Asumí 750cc (la presentación default del
--     resto de la categoría).
--   - "Blender's 1 L â $10.400": el catálogo solo tenía Blender's 750cc
--     (WHISKY-BLENDERS-750). Se da de alta un SKU nuevo de 1L del mismo
--     producto (no un override) porque el volumen es explícito y distinto.
--
-- Nuevos: Cutty Sark, VAT 69 -- no existían en ninguna categoría.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values ('Cutty Sark'), ('VAT 69');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Whisky')
from (values
  ('Cutty Sark', 'Cutty Sark'),
  ('VAT 69', 'VAT 69')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('Cutty Sark', 'Cutty Sark 750cc', 'WHISKY-CUTTYSARK-750', 750),
  ('VAT 69', 'VAT 69 750cc', 'WHISKY-VAT69-750', 750),
  ('Blender''s', 'Blender''s 1L', 'WHISKY-BLENDERS-1000', 1000)
) as v(producto, nombre_sku, codigo, volumen)
join productos p on p.nombre = v.producto;

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  -- Overrides sobre SKUs existentes (09_whisky.sql)
  ('WHISKY-FIREBALL-750', 26300),
  ('WHISKY-JD-750', 47600),
  ('WHISKY-JDAPPLE-1000', 54500),
  ('WHISKY-JDFIRE-1000', 54500),
  ('WHISKY-SINGLETON15-750', 118700),
  ('WHISKY-CARDU-750', 128500),
  ('WHISKY-JWBLACK-750', 49500),
  ('WHISKY-JWBLACK-1000', 67300),
  ('WHISKY-JWBLUE-750', 420000),
  ('WHISKY-GRANTS-750', 31500),
  ('WHISKY-JWGREEN-750', 193300),
  ('WHISKY-WHITEHORSE-750', 18600),
  ('WHISKY-JIMBEAM-HONEY-750', 42300),
  -- SKUs nuevos
  ('WHISKY-CUTTYSARK-750', 41000),
  ('WHISKY-VAT69-750', 7650),
  ('WHISKY-BLENDERS-1000', 10400)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
