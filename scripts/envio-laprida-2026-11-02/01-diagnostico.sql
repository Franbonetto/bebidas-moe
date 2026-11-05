-- =====================================================================
-- Entrega a Laprida del 02/11 (+ 4 líneas del 03/11) cargada por error
-- como merma de Olavarría — PASO 1: DIAGNÓSTICO (solo lectura)
-- =====================================================================
-- El lunes 02/11 se mandó mercadería a Laprida y en Olavarría se
-- registró como merma ('consumo_interno'/'otro') con la nota "laprida" o
-- "Entrega ayer Laprida" (estas últimas 4, del 03/11, son del mismo
-- envío, anotadas un día tarde). La salida de stock en Olavarría es
-- correcta: esa mercadería salió de verdad. Lo que falta es que entre a
-- Laprida (02-ajustes.sql).
--
-- Deja afuera a propósito la tanda del 26/10 (envío de la semana
-- anterior, con las mismas notas): se decidió tratarla por separado.

select
  m.id as merma_id,
  m.fecha,
  sk.id as sku_id,
  sk.nombre,
  sk.codigo_interno,
  m.motivo,
  m.detalle,
  m.cantidad,
  u.nombre as usuario
from mermas m
join skus sk on sk.id = m.sku_id
join sucursales s on s.id = m.sucursal_id
left join usuarios u on u.id = m.usuario_id
where s.nombre = 'Olavarría'
  and m.detalle ilike '%laprida%'
  and m.fecha >= '2026-11-02'
order by m.fecha, sk.nombre;
