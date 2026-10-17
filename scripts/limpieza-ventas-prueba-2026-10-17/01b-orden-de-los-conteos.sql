-- =====================================================================
-- ¿El conteo de carga inicial fue DESPUÉS de la venta de prueba?
-- =====================================================================
--
-- SOLO LECTURA. Esta pregunta decide si hay que reponer stock o no, y la
-- respuesta es distinta para cada SKU.
--
-- POR QUÉ IMPORTA: cargar_stock_inicial() no suma, FIJA
-- (20260929090000_carga_inicial_stock.sql: `v_delta := p_cantidad -
-- v_stock_actual`). Si un SKU quedó en -1 por una venta de prueba y
-- después alguien contó 52 en la góndola, la carga inicial escribió un
-- movimiento de +53 para llegar a 52. O sea: el conteo YA absorbió la
-- venta falsa.
--
-- En ese caso reponer +1 dejaría 53 donde hay 52 físicas. Al revés, un
-- SKU que nunca se contó (o que se contó ANTES de la venta) sí hay que
-- reponerlo.
--
-- Veredicto por fila:
--   REPONER          no hay conteo posterior a la venta: la venta falsa
--                    sigue restando del stock de hoy y hay que devolverla.
--   YA ABSORBIDO     el conteo es posterior: el stock de hoy ya es el
--                    número que se contó en la góndola. No se repone.
-- =====================================================================

with ventas_falsas as (
  -- Todos los movimientos nacidos de una venta, con su fecha.
  select
    m.sku_id,
    m.sucursal_id,
    sum(m.cantidad)  as neto_vendido,
    count(*)         as movimientos,
    max(m.fecha)     as ultima_venta
  from movimientos_stock m
  where m.documento_tipo = 'venta'
  group by m.sku_id, m.sucursal_id
),
conteos as (
  select m.sku_id, m.sucursal_id, max(m.fecha) as ultimo_conteo
  from movimientos_stock m
  where m.documento_tipo = 'carga_inicial'
  group by m.sku_id, m.sucursal_id
)
select
  sk.codigo_interno,
  s.nombre as sucursal,
  vf.movimientos,
  -vf.neto_vendido                                        as unidades_vendidas,
  coalesce(ss.cantidad, 0)                                as stock_hoy,
  to_char(vf.ultima_venta at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') as ultima_venta,
  coalesce(
    to_char(c.ultimo_conteo at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'),
    'nunca se contó'
  )                                                       as ultimo_conteo,
  case
    when c.ultimo_conteo is null            then 'REPONER (nunca se contó)'
    when c.ultimo_conteo > vf.ultima_venta  then 'YA ABSORBIDO (se contó después)'
    else 'REPONER (se contó antes)'
  end                                                     as veredicto,
  case
    when c.ultimo_conteo is null or c.ultimo_conteo <= vf.ultima_venta
      then (coalesce(ss.cantidad, 0) - vf.neto_vendido)::text
    else coalesce(ss.cantidad, 0)::text
  end                                                     as stock_al_terminar
from ventas_falsas vf
join skus sk        on sk.id = vf.sku_id
join sucursales s   on s.id = vf.sucursal_id
left join stock_sucursal ss on ss.sku_id = vf.sku_id and ss.sucursal_id = vf.sucursal_id
left join conteos c on c.sku_id = vf.sku_id and c.sucursal_id = vf.sucursal_id
order by veredicto, sk.codigo_interno;
