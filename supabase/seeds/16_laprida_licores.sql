-- Carga real de catálogo + precios de Laprida — categoría nueva LICORES
-- (lista de precios de Laprida, 12/09/26, sección "LICORES Y MAS").
--
-- "Burnett's — $9.000" de esta sección NO es un producto nuevo: ya existe
-- como GIN-BURNETTS-750 (categoría Gin, cargado en 01_gin.sql). Se le
-- agrega el override de Laprida sobre ese mismo SKU en vez de duplicarlo
-- -- mismo caso que "1882" en la tanda de Aperitivos.
--
-- El resto de los productos son nuevos: se dan de alta en Olavarría SIN
-- precio y Laprida recibe el override, mismo criterio que las tandas
-- anteriores.
--
-- Volúmenes: la lista no aclara ninguno. Busqué la presentación real de
-- venta en Argentina en vez de asumir a ciegas:
--   - Velho Barreiro (Gold y clásico): 910cc confirmado (cachaça, viene
--     así de fábrica).
--   - 1 de Agosto (caña): 930cc confirmado.
--   - Tía María, Amarula, Bailey's: 750cc confirmado.
--   - Strega Limoncello: 700cc confirmado (así vende Strega en Argentina).
--   - Mariposa, San Vicente, DF Licor tequila, Conquistador MX, Tres
--     Plumas, La Scala, Nuvo: NO encontré dato real de presentación --
--     supuse 750cc (el más común en la categoría). Si está mal, se
--     corrige después igual que las latas de cerveza.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Licores');

insert into marcas (nombre) values
  ('Velho Barreiro'), ('Mariposa'), ('San Vicente'), ('DF'), ('Conquistador MX'),
  ('Tía María'), ('Strega'), ('1 de Agosto'), ('Tres Plumas'), ('La Scala'),
  ('Amarula'), ('Bailey''s'), ('Nuvo');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Licores')
from (values
  ('Velho Barreiro Gold', 'Velho Barreiro'),
  ('Velho Barreiro', 'Velho Barreiro'),
  ('Mariposa', 'Mariposa'),
  ('San Vicente', 'San Vicente'),
  ('DF Licor Tequila', 'DF'),
  ('Conquistador MX', 'Conquistador MX'),
  ('Tía María Crema', 'Tía María'),
  ('Tía María Café', 'Tía María'),
  ('Strega Limoncello', 'Strega'),
  ('1 de Agosto', '1 de Agosto'),
  ('Tres Plumas', 'Tres Plumas'),
  ('La Scala Licor Choco', 'La Scala'),
  ('Amarula Café', 'Amarula'),
  ('Amarula Raspberry', 'Amarula'),
  ('Bailey''s Classic', 'Bailey''s'),
  ('Bailey''s Caramelo', 'Bailey''s'),
  ('Nuvo', 'Nuvo')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('Velho Barreiro Gold', 'Velho Barreiro Gold 910cc', 'LICOR-VELHOBARREIROGOLD-910', 910),
  ('Velho Barreiro', 'Velho Barreiro 910cc', 'LICOR-VELHOBARREIRO-910', 910),
  ('Mariposa', 'Mariposa 750cc', 'LICOR-MARIPOSA-750', 750),
  ('San Vicente', 'San Vicente 750cc', 'LICOR-SANVICENTE-750', 750),
  ('DF Licor Tequila', 'DF Licor Tequila 750cc', 'LICOR-DFTEQUILA-750', 750),
  ('Conquistador MX', 'Conquistador MX 750cc', 'LICOR-CONQUISTADORMX-750', 750),
  ('Tía María Crema', 'Tía María Crema 750cc', 'LICOR-TIAMARIACREMA-750', 750),
  ('Tía María Café', 'Tía María Café 750cc', 'LICOR-TIAMARIACAFE-750', 750),
  ('Strega Limoncello', 'Strega Limoncello 700cc', 'LICOR-STREGALIMONCELLO-700', 700),
  ('1 de Agosto', '1 de Agosto Caña 930cc', 'LICOR-1DEAGOSTO-930', 930),
  ('Tres Plumas', 'Tres Plumas 750cc', 'LICOR-TRESPLUMAS-750', 750),
  ('La Scala Licor Choco', 'La Scala Licor Choco 750cc', 'LICOR-LASCALACHOCO-750', 750),
  ('Amarula Café', 'Amarula Café 750cc', 'LICOR-AMARULACAFE-750', 750),
  ('Amarula Raspberry', 'Amarula Raspberry 750cc', 'LICOR-AMARULARASPBERRY-750', 750),
  ('Bailey''s Classic', 'Bailey''s Classic 750cc', 'LICOR-BAILEYSCLASSIC-750', 750),
  ('Bailey''s Caramelo', 'Bailey''s Caramelo 750cc', 'LICOR-BAILEYSCARAMELO-750', 750),
  ('Nuvo', 'Nuvo 750cc', 'LICOR-NUVO-750', 750)
) as v(producto, nombre_sku, codigo, volumen)
join productos p on p.nombre = v.producto;

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('LICOR-VELHOBARREIROGOLD-910', 8550),
  ('LICOR-VELHOBARREIRO-910', 11650),
  ('LICOR-MARIPOSA-750', 5000),
  ('LICOR-SANVICENTE-750', 5000),
  ('LICOR-DFTEQUILA-750', 6000),
  ('LICOR-CONQUISTADORMX-750', 5000),
  ('LICOR-TIAMARIACREMA-750', 10250),
  ('LICOR-TIAMARIACAFE-750', 10600),
  ('LICOR-STREGALIMONCELLO-700', 26100),
  ('LICOR-1DEAGOSTO-930', 4650),
  ('LICOR-TRESPLUMAS-750', 6500),
  ('GIN-BURNETTS-750', 9000),
  ('LICOR-LASCALACHOCO-750', 13500),
  ('LICOR-AMARULACAFE-750', 39000),
  ('LICOR-AMARULARASPBERRY-750', 45000),
  ('LICOR-BAILEYSCLASSIC-750', 31000),
  ('LICOR-BAILEYSCARAMELO-750', 36000),
  ('LICOR-NUVO-750', 78500)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
