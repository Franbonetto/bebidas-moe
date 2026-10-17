-- =====================================================================
-- ¿Cuánto stock hay contado hoy? — SOLO LECTURA
-- =====================================================================
-- Una sola consulta (el SQL Editor de Supabase muestra solo el resultado
-- del último statement). No escribe nada.
--
-- Sirve para saber cuántos SKU tienen stock de verdad, cuántos quedarían
-- en negativo al descontar las ventas en papel, y de paso para corregir
-- cualquier número viejo que ande dando vueltas.
-- =====================================================================

with central as (
  select id, nombre from sucursales where es_central limit 1
),
satelite as (
  select id, nombre from sucursales where not es_central limit 1
)
select * from (
  select 1 as orden, 'SKU activos en el catálogo' as dato,
         count(*)::text as valor
    from skus where activo

  union all
  select 2, 'SKU con fila de stock en Olavarría',
         count(*)::text
    from stock_sucursal where sucursal_id = (select id from central)

  union all
  select 3, 'SKU con stock mayor a cero en Olavarría',
         count(*)::text
    from stock_sucursal
   where sucursal_id = (select id from central) and cantidad > 0

  union all
  select 4, 'SKU en cero en Olavarría',
         count(*)::text
    from stock_sucursal
   where sucursal_id = (select id from central) and cantidad = 0

  union all
  select 5, 'SKU en negativo en Olavarría',
         count(*)::text
    from stock_sucursal
   where sucursal_id = (select id from central) and cantidad < 0

  union all
  select 6, 'Unidades totales en Olavarría',
         coalesce(sum(cantidad), 0)::text
    from stock_sucursal where sucursal_id = (select id from central)

  union all
  select 7, 'SKU con stock mayor a cero en Laprida',
         count(*)::text
    from stock_sucursal
   where sucursal_id = (select id from satelite) and cantidad > 0

  union all
  select 8, 'Unidades totales en Laprida',
         coalesce(sum(cantidad), 0)::text
    from stock_sucursal where sucursal_id = (select id from satelite)

  union all
  select 9, 'Movimientos de stock en total',
         count(*)::text
    from movimientos_stock

  union all
  select 10, 'Movimientos de carga inicial',
         count(*)::text
    from movimientos_stock
   where motivo ilike '%inicial%'

  union all
  select 11, 'Fecha del último movimiento',
         coalesce(to_char(max(fecha), 'YYYY-MM-DD HH24:MI'), 'ninguno')
    from movimientos_stock

  union all
  select 12, 'Movimientos por venta en papel del 2026-10-15',
         count(*)::text
    from movimientos_stock
   where motivo = 'Venta en papel del 2026-10-15'
) t
order by orden;
