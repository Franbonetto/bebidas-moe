-- Carga real de catálogo + precios de Laprida — sección "TABACO" de la
-- lista de Laprida (12/09/26). Cruza fuerte con 04_tabacos.sql: la
-- mayoría son overrides sobre SKU ya existentes.
--
-- Casos de matching que requirieron normalizar nombres/typos de la
-- planilla:
--   - "Lataria N6" -> es "Layakia N6" (typo de transcripción), ya existe
--     como TABACO-ARGENTO-PIPA-6.
--   - "Tabaco Choice 5/12/16/02/225/01": estos números de línea (01, 02,
--     05, 12, 16, 225) son EXACTAMENTE los mismos que ya están cargados
--     como Mac Barren en 04_tabacos.sql (Original/Vainilla/Aromatic/
--     Manzana/Chocolate/Doble Vainilla) -- se asumió que "Choice" es como
--     le dicen en Laprida a esa misma línea Mac Barren, no una marca
--     nueva. Si en realidad es una marca distinta con la misma numeración
--     (coincidencia rara pero no imposible), avisame para separarla.
--
-- Nuevos (no existían): "Argento Lata" (lata grande, sabor no
-- especificado -- distinto de los pouches #51-59 ya cargados) y "Sayri
-- Clásico" (no es lo mismo que "Sayri Claro", que ya existe con otro
-- precio -- se cargó como producto aparte por las dudas; si en realidad
-- es el mismo producto con otro nombre, se puede fusionar después).

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Tabaco')
from (values
  ('Argento Lata', 'Argento'),
  ('Sayri Clásico', 'Sayri')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', 1, 'un', 1
from (values
  ('Argento Lata', 'Tabaco Argento Lata', 'TABACO-ARGENTO-LATA'),
  ('Sayri Clásico', 'Tabaco Sayri Clásico', 'TABACO-SAYRI-CLASICO')
) as v(producto, nombre_sku, codigo)
join productos p on p.nombre = v.producto
  and p.categoria_id = (select id from categorias where nombre = 'Tabaco');

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  -- Argento Pipa
  ('TABACO-ARGENTO-PIPA-1', 6850),
  ('TABACO-ARGENTO-PIPA-3', 6850),
  ('TABACO-ARGENTO-PIPA-6', 6850),
  ('TABACO-ARGENTO-PIPA-7', 7900),
  ('TABACO-ARGENTO-PIPA-5', 6850),
  -- Argento sabores (mismo precio para las 8 líneas)
  ('TABACO-ARGENTO-51', 5300),
  ('TABACO-ARGENTO-52', 5300),
  ('TABACO-ARGENTO-53', 5300),
  ('TABACO-ARGENTO-54', 5300),
  ('TABACO-ARGENTO-55', 5300),
  ('TABACO-ARGENTO-56', 5300),
  ('TABACO-ARGENTO-58', 5300),
  ('TABACO-ARGENTO-59', 5300),
  -- Red Field 1/2/3/4/12 (mismo precio) + 14 aparte
  ('TABACO-REDFIELD-1', 6300),
  ('TABACO-REDFIELD-2', 6300),
  ('TABACO-REDFIELD-3', 6300),
  ('TABACO-REDFIELD-4', 6300),
  ('TABACO-REDFIELD-12', 6300),
  ('TABACO-REDFIELD-14', 6800),
  -- "Tabaco Choice" = Mac Barren (mismos números de línea)
  ('TABACO-MACBARREN-01', 6800),
  ('TABACO-MACBARREN-02', 6800),
  ('TABACO-MACBARREN-05', 6800),
  ('TABACO-MACBARREN-12', 6800),
  ('TABACO-MACBARREN-16', 6800),
  ('TABACO-MACBARREN-225', 6800),
  -- SKUs nuevos
  ('TABACO-ARGENTO-LATA', 11450),
  ('TABACO-SAYRI-CLASICO', 5800)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
