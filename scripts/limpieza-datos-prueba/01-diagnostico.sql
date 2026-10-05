-- Diagnostico previo a la limpieza de datos de prueba.
--
-- SOLO LECTURA: no modifica nada. Correr cada bloque por separado en el SQL
-- Editor (el editor muestra el resultado de la ultima consulta nada mas:
-- seleccionar el bloque y Run).
--
-- Objetivo: saber cuanto hay de cada cosa antes de decidir que se borra.

-- =========================================================
-- 1) Cuanto hay de cada cosa
-- =========================================================

select * from (
  select  1 as n, 'ventas'                     as tabla, count(*) as filas from ventas
  union all select  2, 'venta_items',                    count(*) from venta_items
  union all select  3, 'venta_pagos',                    count(*) from venta_pagos
  union all select  4, 'devoluciones',                   count(*) from devoluciones
  union all select  5, 'comprobantes_fiscales (ARCA)',   count(*) from comprobantes_fiscales
  union all select  6, 'cajas',                          count(*) from cajas
  union all select  7, 'movimientos_caja',               count(*) from movimientos_caja
  union all select  8, 'movimientos_stock',              count(*) from movimientos_stock
  union all select  9, 'stock_sucursal (filas <> 0)',    count(*) from stock_sucursal where cantidad <> 0
  union all select 10, 'compras',                        count(*) from compras
  union all select 11, 'compra_items',                   count(*) from compra_items
  union all select 12, 'recepciones_compra',             count(*) from recepciones_compra
  union all select 13, 'historial_costos',               count(*) from historial_costos
  union all select 14, 'pedidos_compra',                 count(*) from pedidos_compra
  union all select 15, 'cargas_iniciales',               count(*) from cargas_iniciales
  union all select 16, 'inventarios',                    count(*) from inventarios
  union all select 17, 'mermas',                         count(*) from mermas
  union all select 18, 'pedidos (a Olavarria)',          count(*) from pedidos
  union all select 19, 'transferencias',                 count(*) from transferencias
  union all select 20, 'stock_transito',                 count(*) from stock_transito
  union all select 21, 'movimientos_envases',            count(*) from movimientos_envases
  union all select 22, 'promociones',                    count(*) from promociones
  union all select 23, 'proveedores',                    count(*) from proveedores
  union all select 24, 'productos',                      count(*) from productos
  union all select 25, 'SKU activos',                    count(*) from skus where activo
  union all select 26, 'SKU dados de baja (activo=false)', count(*) from skus where not activo
  union all select 27, 'SKU con codigo de barras',       count(*) from skus where codigo_barras is not null
  union all select 28, 'precios base cargados',          count(*) from precios
) t order by n;

-- =========================================================
-- 2) Los SKU que "sacaste" y quedaron dados de baja
-- =========================================================
-- Estos son los que no se pudieron borrar porque tenian operaciones. Con el
-- detalle de que operaciones tiene cada uno: si todas son ficticias, el
-- script de limpieza los puede borrar de verdad.

select
  s.codigo_interno,
  p.nombre as producto,
  s.nombre as sku,
  (select count(*) from movimientos_stock m where m.sku_id = s.id)   as movimientos,
  (select count(*) from venta_items vi where vi.sku_id = s.id)       as en_ventas,
  (select count(*) from compra_items ci where ci.sku_id = s.id)      as en_compras,
  (select count(*) from inventario_items ii where ii.sku_id = s.id)  as en_inventarios,
  (select count(*) from mermas me where me.sku_id = s.id)            as mermas,
  (select count(*) from pedido_items pi where pi.sku_id = s.id)      as en_pedidos,
  (select count(*) from promocion_items pr where pr.sku_id = s.id)   as en_promos
from skus s
join productos p on p.id = s.producto_id
where not s.activo
order by p.nombre, s.nombre;

-- =========================================================
-- 3) Catalogo de ejemplo que vino con el sistema
-- =========================================================
-- Los 8 SKU del seed inicial (Quilmes, Branca, Gordon's). Informativo: la
-- limpieza NO los toca. Si alguno sobra, se saca con la X desde Productos
-- despues de limpiar, y ahi si se borra de verdad porque ya no va a tener
-- historia.

select
  s.codigo_interno,
  p.nombre as producto,
  s.nombre as sku,
  s.codigo_barras,
  s.activo
from skus s
join productos p on p.id = s.producto_id
where s.codigo_interno in (
  'QUI-CLAS-UN', 'QUI-CLAS-X6', 'QUI-CLAS-X24', 'QUI-CLAS-1L-RET',
  'BRANCA-750', 'BRANCA-MENTA-750', 'GORDONS-LD-750', 'GORDONS-PINK-700'
)
order by p.nombre, s.nombre;

-- =========================================================
-- 4) Lo que cargaste vos: por categoria y si tiene codigo de barras
-- =========================================================
-- Sirve para confirmar que lo de vino esta completo y que falta cerveza,
-- gaseosas, regaleria, embutidos y tabaco.

select
  coalesce(cp.nombre || ' > ', '') || c.nombre as categoria,
  count(*)                                              as skus,
  count(s.codigo_barras)                                as con_codigo_barras,
  count(*) - count(s.codigo_barras)                      as sin_codigo_barras,
  count(pr.sku_id)                                       as con_precio
from skus s
join productos p   on p.id = s.producto_id
join categorias c  on c.id = p.categoria_id
left join categorias cp on cp.id = c.categoria_padre_id
left join precios pr    on pr.sku_id = s.id
where s.activo
group by 1
order by 1;

-- =========================================================
-- 5) Movimientos de stock por tipo y por documento
-- =========================================================
-- Para ver de donde viene el stock que hoy figura cargado.

select
  m.tipo,
  coalesce(m.documento_tipo, '(sin documento)') as documento,
  count(*)        as movimientos,
  min(m.fecha)::date as desde,
  max(m.fecha)::date as hasta
from movimientos_stock m
group by 1, 2
order by 3 desc;

-- =========================================================
-- 6) Las compras cargadas, una por una
-- =========================================================
-- Es lo unico que falta decidir: si alguna de estas es una factura real de
-- un proveedor real, hay que conservarla (borrar_compras = false en
-- 02-limpieza.sql). Si son todas de prueba, borrar_compras = true.
--
-- El dato que lo define es el numero de factura: una compra real tiene el
-- numero del comprobante que te dio el proveedor.

select
  c.fecha_factura,
  coalesce(pv.nombre_comercial, pv.razon_social) as proveedor,
  c.numero_factura,
  c.estado,
  c.total,
  (select count(*) from compra_items ci where ci.compra_id = c.id)       as items,
  (select count(*) from recepciones_compra r where r.compra_id = c.id)   as recepciones,
  (select coalesce(sum(m.cantidad), 0)
     from movimientos_stock m
    where m.documento_tipo = 'recepcion_compra'
      and m.documento_id in (select r.id from recepciones_compra r where r.compra_id = c.id)
  ) as unidades_que_entraron
from compras c
join proveedores pv on pv.id = c.proveedor_id
order by c.fecha_factura nulls last, proveedor;
