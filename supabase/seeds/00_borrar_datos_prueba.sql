-- Reset del catálogo de prueba antes de cargar datos reales.
-- NO es una migración de schema -- no toca tablas ni funciones, solo
-- borra filas. Por eso vive en supabase/seeds/, no en
-- supabase/migrations/ (que es solo para evolución de schema).
--
-- Usa TRUNCATE en vez de DELETE a propósito: varias de estas tablas
-- (cajas, ventas, venta_items, devoluciones*, movimientos_stock,
-- stock_sucursal, compra_items, pedido_items, transferencias*,
-- stock_envases, movimientos_envases) están bloqueadas contra escritura
-- directa con triggers "before insert or update or delete" que exigen un
-- flag de sesión por tabla (bebidas_moe.venta_en_curso,
-- movimiento_en_curso, recepcion_en_curso, pedido_en_curso,
-- transferencia_en_curso, movimiento_envase_en_curso,
-- devolucion_en_curso) o validan el estado del padre (ej. compra_items
-- exige que la compra este en 'borrador'). Un DELETE comun los dispara
-- fila por fila y probablemente falla a mitad de camino. TRUNCATE, en
-- cambio, NO dispara triggers por fila (es un comportamiento estandar de
-- Postgres) -- exactamente lo que hace falta para un reset completo como
-- este, que por definicion no tiene que respetar el flujo de negocio
-- normal.
--
-- CASCADE cubre cualquier tabla con FK hacia estas que se me haya
-- pasado por alto -- las que ya estan listadas explicitamente son, hasta
-- donde revisé, todas las que dependen del catálogo/operación de prueba.
-- NO toca usuarios, sucursales ni usuario_sucursal (eso es configuración
-- real de la empresa, no dato de prueba).

begin;

truncate table
  devolucion_cambio_items,
  devolucion_items,
  devoluciones,
  venta_items,
  ventas,
  cajas,
  movimientos_stock,
  stock_sucursal,
  movimientos_envases,
  stock_envases,
  promocion_items,
  promociones,
  precios_sucursal,
  precios,
  recargos_sku,
  recargos_sucursal,
  descuentos_efectivo,
  proveedor_skus,
  historial_costos,
  recepcion_items,
  compra_items,
  recepciones_compra,
  compras,
  proveedores,
  stock_transito,
  transferencia_items,
  transferencias,
  pedido_items,
  pedidos,
  inventario_items,
  inventarios,
  skus,
  productos,
  marcas,
  categorias,
  tipos_envase
cascade;

commit;
