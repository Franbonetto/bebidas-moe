-- Completa FERNET de Laprida (13_laprida_fernet.sql): los dos casos que
-- habían quedado pendientes de confirmar.
--   1. "Buhero 700 ml" de la lista es el mismo "Fernet Buhero Negro
--      750cc" que ya existe (típo en la lista de Laprida) -- confirmado.
--   2. "Cestari" es marca/producto nuevo, 750cc -- confirmado. Se da de
--      alta en el catálogo (Olavarría queda sin precio todavía, decisión
--      ya tomada para productos nuevos que solo aparecen en la lista de
--      Laprida) y Laprida recibe el override.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from usuarios where rol = 'dueno' limit 1)::text)::text,
  true
);

insert into marcas (nombre) values ('Cestari');

insert into productos (nombre, marca_id, categoria_id)
select 'Fernet Cestari', (select id from marcas where nombre = 'Cestari'), (select id from categorias where nombre = 'Fernet');

insert into skus (producto_id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas)
select p.id, 'Fernet Cestari 750cc', 'FERNET-CESTARI-750', 'unidad', 750, 'ml', 1
from productos p
where p.nombre = 'Fernet Cestari';

insert into precios_sucursal (sucursal_id, sku_id, precio_override)
select (select id from sucursales where es_central = false), s.id, v.precio
from (values
  ('FERNET-BUHERONEGRO-750', 8850),
  ('FERNET-CESTARI-750', 15000)
) as v(codigo, precio)
join skus s on s.codigo_interno = v.codigo
on conflict (sucursal_id, sku_id) do update set
  precio_override = excluded.precio_override,
  actualizado_en = now();

commit;
