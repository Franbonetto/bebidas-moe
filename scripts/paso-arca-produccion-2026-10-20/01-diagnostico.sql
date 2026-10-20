-- PASO A PRODUCCIÓN DE ARCA (2026-10-20) — DIAGNÓSTICO
--
-- Solo lee. Correr esto primero, en el SQL Editor, y mirar los
-- resultados antes de correr 02-limpieza.sql.
--
-- Es UNA sola consulta a propósito: el SQL Editor de Supabase muestra
-- nada más el resultado de la última sentencia, así que cinco selects
-- sueltos dejarían ver solo el quinto. Todo sale junto, en una tabla con
-- una columna `seccion` que dice qué estás mirando.
--
-- Lo que importa saber: qué comprobantes de homologación hay, de qué
-- ventas son, y cuáles de esas ventas son ventas REALES (el negocio opera
-- en serio desde el 17/10 y la facturación automática arrancó el 19/10).

with
-- 1. Qué hay en la tabla, por estado
resumen as (
  select 1 as orden,
         '1. POR ESTADO' as seccion,
         estado || ' / Factura ' || tipo_cbte as dato_1,
         count(*)::text || ' comprobantes' as dato_2,
         '$' || to_char(sum(importe_total), 'FM999G999G990D00') as dato_3,
         '' as dato_4,
         estado || tipo_cbte as sub
  from comprobantes_fiscales
  group by estado, tipo_cbte
),
-- 2. Uno por uno, con su venta y su sucursal
detalle as (
  select 2,
         '2. DETALLE',
         to_char(cf.creado_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI')
           || '  ' || s.nombre,
         'Factura ' || cf.tipo_cbte || '  PV ' || pv.numero_arca::text
           || '-' || coalesce(cf.numero_comprobante::text, 'sin nro'),
         cf.estado || coalesce('  CAE ' || cf.cae, '')
           || coalesce('  (' || left(cf.motivo_rechazo, 60) || ')', ''),
         '$' || to_char(cf.importe_total, 'FM999G999G990D00') || '  ' || v.medio_pago,
         to_char(cf.creado_en, 'YYYYMMDDHH24MISS')
  from comprobantes_fiscales cf
  join ventas v on v.id = cf.venta_id
  join sucursales s on s.id = v.sucursal_id
  join puntos_venta pv on pv.id = cf.punto_venta_id
),
-- 3. Lo que de verdad hay que mirar: ventas REALES con comprobante de
--    homologación. Son ventas cobradas de verdad cuya "factura" no vale
--    ante ARCA. El 2026-10-17 es el día en que el sistema empezó a
--    operar en serio (ver scripts/limpieza-ventas-prueba-2026-10-17/).
reales as (
  select 3,
         '3. VENTAS REALES AFECTADAS',
         to_char((v.fecha at time zone 'America/Argentina/Buenos_Aires')::date, 'DD/MM')
           || '  ' || s.nombre,
         count(*)::text || ' con comprobante',
         count(*) filter (where cf.estado = 'autorizado')::text || ' autorizadas',
         '$' || to_char(sum(cf.importe_total), 'FM999G999G990D00'),
         to_char(min(v.fecha), 'YYYYMMDD') || s.nombre
  from comprobantes_fiscales cf
  join ventas v on v.id = cf.venta_id
  join sucursales s on s.id = v.sucursal_id
  where v.fecha >= '2026-10-17'
  group by (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date, s.nombre
),
-- 4. Puntos de venta cargados hoy. Son los de HOMOLOGACIÓN: hay que
--    reemplazarlos por los de producción (13 Olavarría / 14 Laprida)
--    desde /vender/facturar/configuracion. Este script no los toca.
puntos as (
  select 4,
         '4. PUNTOS DE VENTA CARGADOS',
         s.nombre,
         'numero_arca = ' || pv.numero_arca::text,
         case when pv.activo then 'activo' else 'inactivo' end,
         'reemplazar por 13 (Olavarria) / 14 (Laprida)',
         s.nombre
  from puntos_venta pv
  join sucursales s on s.id = pv.sucursal_id
),
-- 5. Catálogo de condiciones de IVA, sincronizado contra homologación.
--    Los códigos son los mismos en producción (son tabla de ARCA, no del
--    ambiente), así que no hace falta borrarlo -- pero conviene volver a
--    sincronizarlo ya en producción, que además sirve de primera prueba
--    de que el certificado nuevo funciona.
condiciones as (
  select 5,
         '5. CONDICIONES DE IVA',
         count(*)::text || ' condiciones en el catalogo',
         'ultima sincronizacion: ' || coalesce(to_char(max(actualizado_en), 'DD/MM/YYYY'), 'nunca'),
         '',
         '',
         ''
  from condicion_iva
)
select seccion, dato_1, dato_2, dato_3, dato_4
from (
  select * from resumen
  union all select * from detalle
  union all select * from reales
  union all select * from puntos
  union all select * from condiciones
) t(orden, seccion, dato_1, dato_2, dato_3, dato_4, sub)
order by orden, sub;
