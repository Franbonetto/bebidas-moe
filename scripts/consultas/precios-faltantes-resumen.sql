-- =====================================================================
-- Cuántos SKU le falta precio, por categoría — SOLO LECTURA
-- =====================================================================
-- El hermano chico de `precios-faltantes.sql`: mismo criterio, pero
-- contado por categoría en vez de línea por línea. Sirve para dimensionar
-- el trabajo y para decidir por dónde empezar.
--
-- Una sola consulta. No escribe nada.
--
-- Columnas:
--   SIN_PRECIO    -> no hay fila en `precios` para ese SKU
--   EN_CERO       -> precio cargado en 0
--   DE_RELLENO    -> precio en 111 / 1111 / 11111
--   A_REVISAR     -> la suma de los tres
--   EN_GONDOLA    -> de esos, cuántos tienen stock en Olavarría (los
--                    urgentes: están en el salón sin precio real)
--   UNIDADES      -> cuántas unidades hay en góndola sin precio, que es
--                    la plata parada
-- =====================================================================

with central as (
  select id from sucursales where es_central limit 1
),

rellenos (valor) as (
  values (111::numeric), (1111), (11111)
),

estado as (
  select
    c.nombre as categoria,
    coalesce(ps.precio_override, pr.precio_base) as precio_lista,
    coalesce(ss.cantidad, 0) as stock
  from skus s
  join productos p on p.id = s.producto_id
  join categorias c on c.id = p.categoria_id
  left join precios pr on pr.sku_id = s.id
  left join precios_sucursal ps
    on ps.sku_id = s.id and ps.sucursal_id = (select id from central)
  left join stock_sucursal ss
    on ss.sku_id = s.id and ss.sucursal_id = (select id from central)
  where s.activo
),

clasificado as (
  select
    categoria,
    stock,
    case
      when precio_lista is null then 'sin_precio'
      when precio_lista = 0     then 'en_cero'
      when precio_lista in (select valor from rellenos) then 'de_relleno'
      else 'ok'
    end as situacion
  from estado
)

select
  categoria,
  count(*) filter (where situacion = 'sin_precio')                  as sin_precio,
  count(*) filter (where situacion = 'en_cero')                     as en_cero,
  count(*) filter (where situacion = 'de_relleno')                  as de_relleno,
  count(*) filter (where situacion <> 'ok')                         as a_revisar,
  count(*) filter (where situacion <> 'ok' and stock > 0)           as en_gondola,
  coalesce(sum(stock) filter (where situacion <> 'ok' and stock > 0), 0) as unidades,
  count(*) filter (where situacion = 'ok')                          as con_precio_ok
from clasificado
group by categoria

union all

select
  'TOTAL',
  count(*) filter (where situacion = 'sin_precio'),
  count(*) filter (where situacion = 'en_cero'),
  count(*) filter (where situacion = 'de_relleno'),
  count(*) filter (where situacion <> 'ok'),
  count(*) filter (where situacion <> 'ok' and stock > 0),
  coalesce(sum(stock) filter (where situacion <> 'ok' and stock > 0), 0),
  count(*) filter (where situacion = 'ok')
from clasificado

order by 5 desc, 1;
