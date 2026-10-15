-- =====================================================================
-- DIAGNÓSTICO ANTES DE LIMPIAR VENTAS Y CAJAS — SOLO LECTURA
-- =====================================================================
--
-- Pedido del usuario 2026-10-15: borrar las ventas y las cajas de prueba
-- y dejar el sistema listo para operar, SIN tocar nada del catálogo ni de
-- la carga inicial.
--
-- Este archivo no borra nada.
--
-- Es UNA SOLA consulta a propósito: el SQL Editor de Supabase muestra solo
-- el resultado del último statement, así que ocho consultas sueltas
-- devolvían solo la última. Se corre todo el archivo de una y sale una
-- tabla con todo, ordenada por bloque.
--
-- Las dos cosas que no se pueden decidir a ciegas:
--
--   1. ¿El stock vuelve a subir al borrar las ventas, o queda como lo
--      contaste? Depende de si cada venta de prueba fue ANTES o DESPUÉS
--      del conteo de ese SKU. Si fue después, bajó stock que físicamente
--      nunca salió y hay que devolverlo. Si fue antes, el conteo ya lo
--      absorbió y devolverlo dejaría el stock inflado. Lo responde el
--      bloque 4, SKU por SKU.
--
--   2. ¿Hay comprobantes fiscales de producción? Un CAE de homologación no
--      vale nada y se borra sin drama. Uno de producción es una factura
--      real en ARCA: borrar la fila local no la da de baja. Lo responde el
--      bloque 7.
-- =====================================================================

with conteo as (
  select sku_id, sucursal_id, max(fecha) as fecha_conteo
    from movimientos_stock
   where documento_tipo = 'carga_inicial'
   group by sku_id, sucursal_id
),

-- BLOQUE 1 — Lo que se iría
b1 as (
  select 110 as orden, 'ventas'            as concepto, count(*)::text as valor from ventas
  union all select 111, 'venta_items',       count(*)::text from venta_items
  union all select 112, 'venta_pagos',       count(*)::text from venta_pagos
  union all select 113, 'cajas',             count(*)::text from cajas
  union all select 114, 'movimientos_caja',  count(*)::text from movimientos_caja
  union all select 115, 'devoluciones',      count(*)::text from devoluciones
  union all select 116, 'comprobantes',      count(*)::text from comprobantes_fiscales
  union all select 117, 'primera venta',     coalesce(min(fecha)::date::text, '-') from ventas
  union all select 118, 'última venta',      coalesce(max(fecha)::date::text, '-') from ventas
),

-- BLOQUE 2 — Lo que NO se toca
b2 as (
  select 210 as orden, 'SKU activos' as concepto, count(*)::text as valor from skus where activo
  union all select 211, 'productos',            count(*)::text from productos
  union all select 212, 'precios base',         count(*)::text from precios
  union all select 213, 'precios en efectivo',  count(*)::text from precios_efectivo
  union all select 214, 'promociones',          count(*)::text from promociones
  union all select 215, 'cargas iniciales',     count(*)::text from cargas_iniciales
  union all select 216, 'filas con stock',      count(*)::text from stock_sucursal where cantidad <> 0
  union all select 217, 'unidades en stock',    coalesce(sum(cantidad)::text, '0') from stock_sucursal
  union all select 218, 'SKU con costo',        count(*)::text from skus where costo_actual is not null
),

-- BLOQUE 3 — Movimientos de stock por tipo
b3 as (
  select
    310 as orden,
    m.tipo || ' · ' || coalesce(m.documento_tipo, '(sin documento)') as concepto,
    count(*)::text || ' mov · neto ' || sum(m.cantidad)::text
      || ' · ' || min(m.fecha)::date::text || ' a ' || max(m.fecha)::date::text as valor
  from movimientos_stock m
  group by m.tipo, m.documento_tipo
),

-- BLOQUE 4 — ¿Se vendió antes o después de contar?
b4 as (
  select
    410 as orden,
    s.codigo_interno || ' · ' || coalesce(pr.nombre, s.nombre) || ' · ' || suc.nombre as concepto,
    'stock hoy ' || coalesce(ss.cantidad::text, '-')
      || ' · conteo ' || coalesce(c.fecha_conteo::date::text, 'SIN CONTEO')
      || ' · pre ' || (-sum(case when c.fecha_conteo is not null and m.fecha <= c.fecha_conteo
                                 then m.cantidad else 0 end))::text
      || ' · post ' || (-sum(case when c.fecha_conteo is null or m.fecha > c.fecha_conteo
                                  then m.cantidad else 0 end))::text as valor
  from movimientos_stock m
  join skus s           on s.id = m.sku_id
  left join productos pr on pr.id = s.producto_id
  join sucursales suc   on suc.id = m.sucursal_id
  left join conteo c    on c.sku_id = m.sku_id and c.sucursal_id = m.sucursal_id
  left join stock_sucursal ss
         on ss.sku_id = m.sku_id and ss.sucursal_id = m.sucursal_id
  where m.tipo in ('venta', 'devolucion_entrada')
  group by s.codigo_interno, pr.nombre, s.nombre, suc.nombre, ss.cantidad, c.fecha_conteo
),

-- BLOQUE 5 — Cajas
b5 as (
  select
    510 as orden,
    suc.nombre || ' · ' || ca.fecha::text as concepto,
    ca.estado
      || ' · apertura ' || ca.monto_apertura::text
      || ' · tickets ' || coalesce(ca.cantidad_tickets::text, '-')
      || ' · ventas ' || (select count(*) from ventas v where v.caja_id = ca.id)::text
      || ' · sistema ' || coalesce(ca.efectivo_sistema::text, '-')
      || ' · declarado ' || coalesce(ca.efectivo_declarado::text, '-') as valor
  from cajas ca
  join sucursales suc on suc.id = ca.sucursal_id
),

-- BLOQUE 6 — Envases
b6 as (
  select
    610 as orden,
    te.nombre || ' · ' || suc.nombre || ' · ' || me.tipo as concepto,
    count(*)::text || ' mov · neto ' || sum(me.cantidad)::text
      || ' · de una venta ' || count(me.venta_id)::text as valor
  from movimientos_envases me
  join tipos_envase te on te.id = me.tipo_envase_id
  join sucursales suc  on suc.id = me.sucursal_id
  group by te.nombre, suc.nombre, me.tipo
),

-- BLOQUE 7 — Comprobantes fiscales
b7 as (
  select
    710 as orden,
    'Factura ' || cf.tipo_cbte || ' · PV ' || coalesce(pv.numero_arca::text, '-')
      || ' · nro ' || coalesce(cf.numero_comprobante::text, '-') as concepto,
    cf.estado
      || ' · CAE ' || coalesce(cf.cae, 'sin CAE')
      || ' · ' || cf.creado_en::date::text
      || ' · $' || cf.importe_total::text
      || ' · receptor ' || coalesce(cf.cuit_receptor, 'consumidor final') as valor
  from comprobantes_fiscales cf
  left join puntos_venta pv on pv.id = cf.punto_venta_id
),

-- BLOQUE 8 — Otras operaciones
b8 as (
  select 810 as orden, 'mermas' as concepto, count(*)::text as valor from mermas
  union all select 811, 'inventarios',       count(*)::text from inventarios
  union all select 812, 'pedidos',           count(*)::text from pedidos
  union all select 813, 'transferencias',    count(*)::text from transferencias
  union all select 814, 'pedidos de compra', count(*)::text from pedidos_compra
  union all select 815, 'compras',           count(*)::text from compras
  union all select 816, 'recepciones',       count(*)::text from recepciones_compra
  union all select 817, 'historial de costos', count(*)::text from historial_costos
  union all select 818, 'historial de costos de carga inicial',
                        count(*)::text from historial_costos where carga_inicial_id is not null
),

todo as (
  select orden, '1 · SE IRÍA'          as bloque, concepto, valor from b1
  union all select orden, '2 · NO SE TOCA',         concepto, valor from b2
  union all select orden, '3 · MOVIMIENTOS',        concepto, valor from b3
  union all select orden, '4 · VENTAS VS CONTEO',   concepto, valor from b4
  union all select orden, '5 · CAJAS',              concepto, valor from b5
  union all select orden, '6 · ENVASES',            concepto, valor from b6
  union all select orden, '7 · COMPROBANTES',       concepto, valor from b7
  union all select orden, '8 · OTRAS OPERACIONES',  concepto, valor from b8
)

select bloque, concepto, valor
  from todo
 order by orden, concepto;
