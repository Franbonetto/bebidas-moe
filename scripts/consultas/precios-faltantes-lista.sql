-- =====================================================================
-- Lista de lo que le falta precio, en una sola columna — SOLO LECTURA
-- =====================================================================
-- Lo mismo que `precios-faltantes.sql` pero en una línea de texto por
-- SKU, para que la lista entera entre de una sola vez (la versión ancha
-- devuelve 19 columnas y no se puede copiar completa).
--
-- Formato de cada línea:
--   categoría | producto (SKU si difiere) | código interno | stock | precio
--
-- El precio dice SIN PRECIO cuando no hay nada cargado, o el número de
-- relleno (111, 1111, 11111) cuando lo hay.
--
-- La marca no va: en este catálogo el nombre del producto ya la trae
-- ("Monster ULTRA", "Imperial Ipa"), y repetirla hacía que la lista no
-- entrara de una.
--
-- Orden: categoría, producto.
-- =====================================================================

with central as (
  select id from sucursales where es_central limit 1
),

rellenos (valor) as (
  values (111::numeric), (1111), (11111)
)

select
  c.nombre
    || ' | ' || p.nombre
    || case when s.nombre <> p.nombre then ' (' || s.nombre || ')' else '' end
    || ' | ' || s.codigo_interno
    || ' | stock ' || coalesce(ss.cantidad, 0)::text
    || ' | ' || coalesce(
         case
           when coalesce(psu.precio_override, pr.precio_base) is null then 'SIN PRECIO'
           when coalesce(psu.precio_override, pr.precio_base) = 0     then 'EN CERO'
           else trim(to_char(coalesce(psu.precio_override, pr.precio_base), '999999990'))
         end, 'SIN PRECIO')
  as lista
from skus s
join productos p on p.id = s.producto_id
join categorias c on c.id = p.categoria_id
left join precios pr on pr.sku_id = s.id
left join precios_sucursal psu
  on psu.sku_id = s.id and psu.sucursal_id = (select id from central)
left join stock_sucursal ss
  on ss.sku_id = s.id and ss.sucursal_id = (select id from central)
where s.activo
  and (
    coalesce(psu.precio_override, pr.precio_base) is null
    or coalesce(psu.precio_override, pr.precio_base) = 0
    or coalesce(psu.precio_override, pr.precio_base) in (select valor from rellenos)
  )
order by c.nombre, p.nombre, s.nombre;

-- Si al copiarla se corta por lo larga, se corre en dos partes:
-- agregarle `limit 200` al final, y después `limit 200 offset 200`.
