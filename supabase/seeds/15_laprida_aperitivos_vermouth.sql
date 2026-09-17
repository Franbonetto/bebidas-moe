-- Carga real de catálogo + precios de Laprida — categoría nueva
-- APERITIVOS Y VERMOUTH (lista de precios de Laprida, 12/09/26).
--
-- Ninguno de estos productos existía en el catálogo (categoría nueva).
-- Decisión ya confirmada: se dan de alta en Olavarría SIN precio
-- (columna `precios` vacía) y Laprida recibe el precio de esta lista
-- como excepción manual (precios_sucursal.precio_override) -- funciona
-- igual sin precio base (lib/precios.ts: el override gana siempre).
--
-- Volúmenes: la lista solo especifica Gancia 1L, Cinzano 1L, Campari
-- 450cc y 750cc -- el resto lo busqué contra la presentación real de
-- venta en Argentina (Coto/Disco/espaciovino) en vez de asumir a ciegas:
--   - La Fuerza, Aperol, Cynar: 750cc confirmado.
--   - Amargo Obrero, Carpano: 950cc confirmado (formato más grande que
--     Aperol/Cynar, así vienen realmente esas dos marcas).
--   - Coralis, Cynar 70: NO encontré dato real -- supuse 750cc por ser lo
--     más común en esta categoría. Si está mal, se corrige como ya
--     pasó con las latas de cerveza.
--
-- "1882 750 ml — $9.050" de esta sección de la lista NO se cargó acá: es
-- el mismo Fernet 1882 que ya se cargó en 13_laprida_fernet.sql (mismo
-- precio, $9.050) -- la lista lo repite bajo este rubro por cómo está
-- organizada la góndola, no es un producto distinto.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Aperitivos y Vermouth');

insert into marcas (nombre) values
  ('La Fuerza'), ('Amargo Obrero'), ('Aperol'), ('Gancia'), ('Cinzano'),
  ('Campari'), ('Coralis'), ('Cynar'), ('Carpano');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Aperitivos y Vermouth')
from (values
  ('La Fuerza', 'La Fuerza'),
  ('Amargo Obrero', 'Amargo Obrero'),
  ('Aperol', 'Aperol'),
  ('Gancia', 'Gancia'),
  ('Cinzano', 'Cinzano'),
  ('Campari', 'Campari'),
  ('Coralis', 'Coralis'),
  ('Cynar', 'Cynar'),
  ('Cynar 70', 'Cynar'),
  ('Carpano', 'Carpano')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('La Fuerza', 'La Fuerza 750cc', 'APERITIVO-LAFUERZA-750', 750),
  ('Amargo Obrero', 'Amargo Obrero 950cc', 'APERITIVO-AMARGOOBRERO-950', 950),
  ('Aperol', 'Aperol 750cc', 'APERITIVO-APEROL-750', 750),
  ('Gancia', 'Gancia 1L', 'APERITIVO-GANCIA-1000', 1000),
  ('Cinzano', 'Cinzano 1L', 'APERITIVO-CINZANO-1000', 1000),
  ('Campari', 'Campari 450cc', 'APERITIVO-CAMPARI-450', 450),
  ('Coralis', 'Coralis 750cc', 'APERITIVO-CORALIS-750', 750),
  ('Cynar', 'Cynar 750cc', 'APERITIVO-CYNAR-750', 750),
  ('Cynar 70', 'Cynar 70 750cc', 'APERITIVO-CYNAR70-750', 750),
  ('Carpano', 'Carpano 950cc', 'APERITIVO-CARPANO-950', 950)
) as v(producto, nombre_sku, codigo, volumen)
join productos p on p.nombre = v.producto;

-- Campari 750cc: mismo producto "Campari" ya insertado arriba, segunda
-- presentación.
insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, 'Campari 750cc', 'APERITIVO-CAMPARI-750', 'unidad', 750, 'ml', 1
from productos p where p.nombre = 'Campari';

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('APERITIVO-LAFUERZA-750', 18600),
  ('APERITIVO-AMARGOOBRERO-950', 4900),
  ('APERITIVO-APEROL-750', 10600),
  ('APERITIVO-GANCIA-1000', 6900),
  ('APERITIVO-CINZANO-1000', 8750),
  ('APERITIVO-CAMPARI-450', 7350),
  ('APERITIVO-CAMPARI-750', 10050),
  ('APERITIVO-CORALIS-750', 5800),
  ('APERITIVO-CYNAR-750', 10700),
  ('APERITIVO-CYNAR70-750', 11700),
  ('APERITIVO-CARPANO-950', 7000)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
