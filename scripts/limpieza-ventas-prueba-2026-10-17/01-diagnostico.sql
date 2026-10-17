-- =====================================================================
-- DIAGNÓSTICO — ventas de prueba del 15 y 16/10, antes de borrarlas
-- =====================================================================
--
-- SOLO LECTURA. No escribe nada. Correlo entero y mirá el resultado antes
-- de tocar 02-limpieza.sql.
--
-- Es UNA SOLA consulta a propósito: el SQL Editor de Supabase muestra solo
-- el resultado del último statement, así que varias consultas sueltas
-- devolverían solo la última.
--
-- Las fechas se leen SIEMPRE en hora de Argentina (`at time zone`), no en
-- UTC. Una venta de las 23:19 del 16 figura en UTC como del 17: si se
-- filtrara por UTC, esa venta se salvaría del borrado y una venta real de
-- hoy a la madrugada se borraría. Misma convención que el balance de IVA.
-- =====================================================================

with
-- El alcance del borrado, definido una sola vez y reusado en todos los
-- bloques: lo que se ve acá es exactamente lo que 02-limpieza.sql toca.
ventas_objetivo as (
  select
    v.id,
    v.fecha at time zone 'America/Argentina/Buenos_Aires' as fecha_local,
    v.sucursal_id,
    v.caja_id,
    v.medio_pago,
    v.total
  from ventas v
  where (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date
        in (date '2026-10-15', date '2026-10-16')
),
devoluciones_objetivo as (
  select d.id from devoluciones d where d.venta_id in (select id from ventas_objetivo)
),
-- Movimientos de stock que nacieron de esas ventas (y de sus
-- devoluciones, si hubiera). Son los que hay que borrar y reponer.
movimientos_objetivo as (
  select m.*
  from movimientos_stock m
  where (m.documento_tipo = 'venta' and m.documento_id in (select id from ventas_objetivo))
     or (m.documento_tipo = 'devolucion' and m.documento_id in (select id from devoluciones_objetivo))
)

select * from (

  -- ===================================================================
  -- 1. TODAS las ventas del sistema, por día. Para ver si hay algo
  --    fuera del 15 y 16 que este script NO va a tocar.
  -- ===================================================================
  select 10 as orden,
         '1. VENTAS POR DÍA (todas)' as bloque,
         to_char((v.fecha at time zone 'America/Argentina/Buenos_Aires')::date, 'DD/MM/YYYY')
           || case
                when (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date
                     in (date '2026-10-15', date '2026-10-16')
                then '  << SE BORRA'
                else '  (se conserva)'
              end as detalle,
         count(*)::text || ' ventas · $' || to_char(sum(v.total), 'FM999G999G990') as valor
    from ventas v
   group by (v.fecha at time zone 'America/Argentina/Buenos_Aires')::date

  -- ===================================================================
  -- 2. Una fila por venta a borrar.
  -- ===================================================================
  union all
  select 20,
         '2. VENTAS QUE SE BORRAN',
         to_char(vo.fecha_local, 'DD/MM HH24:MI') || ' · ' || s.nombre
           || ' · ' || left(vo.id::text, 8),
         '$' || to_char(vo.total, 'FM999G999G990') || ' · ' || vo.medio_pago
           || ' · ' || (select count(*) from venta_items vi where vi.venta_id = vo.id)::text || ' items'
    from ventas_objetivo vo
    join sucursales s on s.id = vo.sucursal_id

  -- ===================================================================
  -- 3. Movimientos de stock por tipo y origen. Acá se ve la diferencia
  --    entre las ventas de prueba y los ajustes de la venta en papel.
  -- ===================================================================
  union all
  select 30,
         '3. MOVIMIENTOS DE STOCK (todos)',
         m.tipo || ' · origen: ' || coalesce(m.documento_tipo, 'sin documento'),
         count(*)::text || ' movimientos · ' || sum(m.cantidad)::text || ' unidades'
    from movimientos_stock m
   group by m.tipo, m.documento_tipo

  -- ===================================================================
  -- 4. Los ajustes de la venta en papel del 15/10: ESOS NO SE TOCAN.
  --    Son mercadería que salió de verdad del mostrador.
  -- ===================================================================
  union all
  select 40,
         '4. VENTA EN PAPEL — NO SE TOCA',
         'ajustes con motivo "Venta en papel%"',
         coalesce(count(*)::text, '0') || ' movimientos · '
           || coalesce(sum(m.cantidad)::text, '0') || ' unidades'
    from movimientos_stock m
   where m.tipo = 'ajuste' and m.motivo like 'Venta en papel%'

  -- ===================================================================
  -- 5. Comprobantes fiscales de esas ventas. SI HAY ALGUNO AUTORIZADO,
  --    leer la advertencia del README antes de seguir.
  -- ===================================================================
  union all
  select 50,
         '5. COMPROBANTES DE ESAS VENTAS',
         'Factura ' || cf.tipo_cbte || ' nro ' || coalesce(cf.numero_comprobante::text, '-')
           || ' · ' || cf.estado,
         'CAE ' || coalesce(cf.cae, 'sin CAE') || ' · $' || to_char(cf.importe_total, 'FM999G999G990')
    from comprobantes_fiscales cf
   where cf.venta_id in (select id from ventas_objetivo)

  union all
  select 51,
         '5. COMPROBANTES DE ESAS VENTAS',
         'total de comprobantes en el sistema',
         (select count(*)::text from comprobantes_fiscales)

  -- ===================================================================
  -- 6. Cajas.
  -- ===================================================================
  union all
  select 60,
         '6. CAJAS',
         to_char(c.fecha, 'DD/MM/YYYY') || ' · ' || s.nombre || ' · ' || c.estado,
         (select count(*) from ventas v where v.caja_id = c.id)::text || ' ventas colgando'
    from cajas c
    join sucursales s on s.id = c.sucursal_id

  -- ===================================================================
  -- 7. Lo demás que cuelga de esas ventas.
  -- ===================================================================
  union all
  select 70, '7. COLGANTES', 'devoluciones de esas ventas',
         (select count(*)::text from devoluciones_objetivo)
  union all
  select 71, '7. COLGANTES', 'movimientos de caja (F7/F8)',
         (select count(*)::text from movimientos_caja)
  union all
  select 72, '7. COLGANTES', 'movimientos de envases de esas ventas',
         (select count(*)::text from movimientos_envases me
           where me.venta_id in (select id from ventas_objetivo))
  union all
  select 73, '7. COLGANTES', 'movimientos de stock a borrar',
         (select count(*)::text from movimientos_objetivo)

  -- ===================================================================
  -- 8. El stock que se repone, SKU por SKU. Los movimientos de venta son
  --    negativos, así que estas son las unidades que vuelven.
  -- ===================================================================
  union all
  select 80,
         '8. STOCK QUE SE REPONE',
         sk.codigo_interno || ' · ' || s.nombre,
         'hoy ' || coalesce(ss.cantidad, 0)::text
           || '  →  ' || (coalesce(ss.cantidad, 0) - sum(mo.cantidad))::text
           || '   (+' || (-sum(mo.cantidad))::text || ')'
    from movimientos_objetivo mo
    join skus sk on sk.id = mo.sku_id
    join sucursales s on s.id = mo.sucursal_id
    left join stock_sucursal ss on ss.sku_id = mo.sku_id and ss.sucursal_id = mo.sucursal_id
   group by sk.codigo_interno, s.nombre, ss.cantidad

  union all
  select 81, '8. STOCK QUE SE REPONE', 'TOTAL de unidades que vuelven',
         coalesce((select (-sum(cantidad))::text from movimientos_objetivo), '0')

  -- ===================================================================
  -- 9. Salud del inventario ANTES de tocar nada.
  -- ===================================================================
  union all
  select 90, '9. SALUD (antes)', 'unidades en stock',
         coalesce((select sum(cantidad)::text from stock_sucursal), '0')
  union all
  select 91, '9. SALUD (antes)', 'filas con stock negativo',
         (select count(*)::text from stock_sucursal where cantidad < 0)
  union all
  select 92, '9. SALUD (antes)', 'filas donde stock <> suma de movimientos',
         (select count(*)::text from stock_sucursal ss
           where ss.cantidad <> coalesce((
             select sum(m.cantidad) from movimientos_stock m
              where m.sku_id = ss.sku_id and m.sucursal_id = ss.sucursal_id), 0))

) t
order by orden, detalle;
