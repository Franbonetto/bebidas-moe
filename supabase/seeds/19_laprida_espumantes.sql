-- Carga real de catálogo + precios de Laprida — categoría nueva
-- ESPUMANTES (lista de precios de Laprida, 12/09/26). Ningún producto de
-- esta sección existía en el catálogo todavía, así que todo es alta
-- nueva: se dan de alta en Olavarría SIN precio y Laprida recibe el
-- override, mismo criterio que las tandas anteriores.
--
-- La sección de la lista mezcla espumantes con sidras y un rosé varietal
-- (Margarita Malbec Rosé no es espumante, es vino) -- se respetó el
-- agrupamiento tal cual está en la planilla de Laprida en vez de
-- reclasificar por tipo de bebida, mismo criterio que "LICORES Y MAS"
-- (que también mezclaba cosas) en la tanda anterior.
--
-- Volúmenes: la lista no aclara ninguno -- se asumió 750cc (estándar de
-- botella de espumante/sidra/vino). Si alguno viene en litro u otra
-- presentación, se corrige después.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into categorias (nombre) values ('Espumantes');

insert into marcas (nombre) values
  ('Emilia'), ('Salentein'), ('Nieto Senetiner'), ('Las Perdices'),
  ('1888'), ('Margarita'), ('Del Valle');

insert into productos (nombre, marca_id, categoria_id)
select v.nombre, m.id, (select id from categorias where nombre = 'Espumantes')
from (values
  ('Emilia Extra Brut', 'Emilia'),
  ('Salentein Brut', 'Salentein'),
  ('Nieto Senetiner Extra Brut', 'Nieto Senetiner'),
  ('Las Perdices Sweety', 'Las Perdices'),
  ('Sidra 1888', '1888'),
  ('Margarita Malbec Rosé', 'Margarita'),
  ('Sidra del Valle', 'Del Valle'),
  ('Fresa Fizz del Valle', 'Del Valle')
) as v(nombre, marca)
join marcas m on m.nombre = v.marca;

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, v.nombre_sku, v.codigo, 'unidad', v.volumen, 'ml', 1
from (values
  ('Emilia Extra Brut', 'Emilia Extra Brut 750cc', 'ESPUM-EMILIA-EXTRABRUT-750', 750),
  ('Salentein Brut', 'Salentein Brut 750cc', 'ESPUM-SALENTEIN-BRUT-750', 750),
  ('Nieto Senetiner Extra Brut', 'Nieto Senetiner Extra Brut 750cc', 'ESPUM-NIETOSENETINER-750', 750),
  ('Las Perdices Sweety', 'Las Perdices Sweety 750cc', 'ESPUM-PERDICES-SWEETY-750', 750),
  ('Sidra 1888', 'Sidra 1888 750cc', 'ESPUM-SIDRA1888-750', 750),
  ('Margarita Malbec Rosé', 'Margarita Malbec Rosé 750cc', 'ESPUM-MARGARITA-ROSE-750', 750),
  ('Sidra del Valle', 'Sidra del Valle 750cc', 'ESPUM-SIDRADELVALLE-750', 750),
  ('Fresa Fizz del Valle', 'Fresa Fizz del Valle 750cc', 'ESPUM-FRESAFIZZDELVALLE-750', 750)
) as v(producto, nombre_sku, codigo, volumen)
join productos p on p.nombre = v.producto;

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('ESPUM-EMILIA-EXTRABRUT-750', 9850),
  ('ESPUM-SALENTEIN-BRUT-750', 13900),
  ('ESPUM-NIETOSENETINER-750', 13600),
  ('ESPUM-PERDICES-SWEETY-750', 8900),
  ('ESPUM-SIDRA1888-750', 6900),
  ('ESPUM-MARGARITA-ROSE-750', 6800),
  ('ESPUM-SIDRADELVALLE-750', 3900),
  ('ESPUM-FRESAFIZZDELVALLE-750', 3700)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
