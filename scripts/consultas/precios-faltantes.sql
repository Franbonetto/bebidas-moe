-- =====================================================================
-- Qué SKU le falta precio, en orden de trabajo — SOLO LECTURA
-- =====================================================================
-- Una sola consulta (el SQL Editor de Supabase muestra solo el resultado
-- del último statement). No escribe nada.
--
-- Trae los SKU activos cuyo precio de venta en Olavarría está:
--   * sin cargar (NULL, no hay fila en `precios`),
--   * en cero, o
--   * en un valor de relleno de los que se usan para salir del paso
--     (111, 1111, 11111 — se agregan más abajo en RELLENOS).
--
-- También mira el precio en efectivo por SKU (`precios_efectivo`): si el
-- de lista está bien pero el de efectivo quedó en cero o en relleno, el
-- SKU aparece igual, y la columna QUE_REVISAR aclara cuál de los dos es.
--
-- El precio de Olavarría se resuelve como lo hace la app (lib/precios.ts):
-- gana el override de sucursal y si no hay, el precio base. La cascada
-- automática de cerveza en lata ya no existe (se eliminó el 2026-09-22),
-- así que todo SKU lleva su precio cargado a mano.
--
-- EL ORDEN es de trabajo, no alfabético:
--   1. Primero las categorías con más unidades en góndola sin precio —
--      ahí está la plata parada. La columna UNIDADES_CATEGORIA es ese
--      número, el mismo que da `precios-faltantes-resumen.sql`.
--   2. Dentro de cada categoría, primero lo que más stock tiene.
--   3. Lo que no tiene stock cae al final de su categoría: existe en el
--      catálogo pero no está en el salón, así que puede esperar.
--   4. La columna N numera las filas para poder tacharlas de a una.
--
-- Para llevarlo a una planilla: botón "Download CSV" abajo del resultado.
-- =====================================================================

with central as (
  select id from sucursales where es_central limit 1
),

-- Valores que se cargan para salir del paso. Si aparece otro, se agrega
-- una línea acá y la consulta lo empieza a traer.
rellenos (valor) as (
  values (111::numeric), (1111), (11111)
),

precio_olavarria as (
  select
    s.id as sku_id,
    coalesce(ps.precio_override, pr.precio_base) as precio_lista,
    case
      when ps.precio_override is not null then 'override de sucursal'
      when pr.precio_base is not null     then 'precio base'
      else                                     'no tiene fila de precio'
    end as origen,
    pe.precio_efectivo
  from skus s
  left join precios pr on pr.sku_id = s.id
  left join precios_sucursal ps
    on ps.sku_id = s.id and ps.sucursal_id = (select id from central)
  left join precios_efectivo pe
    on pe.sku_id = s.id and pe.sucursal_id = (select id from central)
),

faltantes as (
  select
    c.nombre                          as categoria,
    m.nombre                          as marca,
    p.nombre                          as producto,
    s.nombre                          as sku,
    s.codigo_interno,
    s.codigo_barras,
    s.tipo_presentacion               as presentacion,
    s.unidades_contenidas             as unidades_por_bulto,
    po.precio_lista,
    po.precio_efectivo,
    po.origen,
    case
      when po.precio_lista is null then 'SIN PRECIO'
      when po.precio_lista = 0     then 'EN CERO'
      when po.precio_lista in (select valor from rellenos) then 'DE RELLENO'
      else ''
    end                               as precio_de_lista,
    case
      when po.precio_efectivo is null then ''
      when po.precio_efectivo = 0     then 'EN CERO'
      when po.precio_efectivo in (select valor from rellenos) then 'DE RELLENO'
      else ''
    end                               as precio_en_efectivo,
    case
      when (po.precio_lista is null or po.precio_lista = 0
            or po.precio_lista in (select valor from rellenos))
       and (po.precio_efectivo = 0
            or po.precio_efectivo in (select valor from rellenos))
        then 'los dos'
      when po.precio_lista is null or po.precio_lista = 0
        or po.precio_lista in (select valor from rellenos)
        then 'precio de lista'
      else 'precio en efectivo'
    end                               as que_revisar,
    coalesce(ss.cantidad, 0)          as stock_olavarria
  from skus s
  join productos p on p.id = s.producto_id
  join marcas m on m.id = p.marca_id
  join categorias c on c.id = p.categoria_id
  join precio_olavarria po on po.sku_id = s.id
  left join stock_sucursal ss
    on ss.sku_id = s.id and ss.sucursal_id = (select id from central)
  where s.activo
    and (
      po.precio_lista is null
      or po.precio_lista = 0
      or po.precio_lista in (select valor from rellenos)
      or po.precio_efectivo = 0
      or po.precio_efectivo in (select valor from rellenos)
    )
),

-- Unidades sin precio de toda la categoría: define qué categoría va
-- primero, para no saltar de una góndola a otra.
con_peso as (
  select
    f.*,
    sum(f.stock_olavarria) over (partition by f.categoria) as unidades_categoria,
    count(*)               over (partition by f.categoria) as skus_categoria
  from faltantes f
)

select
  row_number() over (
    order by
      z.unidades_categoria desc,
      z.categoria,
      z.stock_olavarria desc,
      z.marca,
      z.producto,
      z.sku
  )                                   as n,
  z.categoria,
  z.unidades_categoria,
  z.skus_categoria,
  z.marca,
  z.producto,
  z.sku,
  z.codigo_interno,
  z.codigo_barras,
  z.presentacion,
  z.unidades_por_bulto,
  z.stock_olavarria,
  case when z.stock_olavarria > 0 then 'EN GONDOLA' else 'sin stock' end as donde,
  z.precio_lista,
  z.precio_de_lista,
  z.precio_efectivo,
  z.precio_en_efectivo,
  z.que_revisar,
  z.origen
from con_peso z
order by n;
