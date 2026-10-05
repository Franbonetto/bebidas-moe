-- =====================================================================
-- LIMPIEZA DE DATOS DE PRUEBA — SCRIPT DE UN SOLO USO
-- =====================================================================
--
-- Pedido del usuario 2026-10-04: dejar el sistema operativo antes de
-- arrancar en serio. Borrar las ventas ficticias y los SKU que se sacaron
-- del catálogo pero quedaron dados de baja porque tenían operaciones
-- colgadas. El catálogo que cargó él se conserva; el stock queda en cero
-- porque todavía no se contó nada (se carga después con Carga inicial).
--
-- ESTO NO ES UNA MIGRACIÓN. No va en supabase/migrations/ a propósito: es
-- un reseteo previo a la puesta en marcha, se corre una vez y no se vuelve
-- a correr nunca. Una vez que el negocio opere de verdad, borrar
-- movimientos deja de ser aceptable (CLAUDE.md regla 2: los movimientos
-- son inmutables, para corregir se ajusta).
--
-- Para poder borrar hay que desactivar los triggers que bloquean la
-- escritura directa sobre stock, ventas, caja, etc. El script los vuelve a
-- prender antes de terminar. Si algo falla, la transacción entera se
-- revierte y los triggers quedan como estaban: no puede quedar a medias.
--
-- Todo corre dentro de una transacción: al final decidís commit o rollback.
--
-- RECOMENDACIÓN: antes de correrlo, sacar un backup del proyecto en
-- Supabase (Database > Backups).
--
-- ---------------------------------------------------------------------
-- QUÉ SE BORRA                                 QUÉ SE CONSERVA
-- ---------------------------------------------------------------------
-- Ventas, items, pagos, devoluciones           Catálogo cargado por vos
-- Comprobantes fiscales (homologación)         Precios base y por sucursal
-- Cajas y movimientos de caja                  Recargos por categoría y SKU
-- Promociones y sus items                      Proveedores
-- Compras, recepciones, costos                 Empleados y usuarios
-- Inventarios y sus conteos                    Categorías y marcas
-- Mermas                                       Tipos de envase
-- Pedidos, transferencias, tránsito
-- Pedidos de compra semanales
-- Movimientos y stock de envases
-- Movimientos de stock → stock queda en 0
-- Carga inicial de stock (se rehace)
-- SKU dados de baja (los que sacaste con la X)
-- Productos que queden sin ningún SKU
-- ---------------------------------------------------------------------

begin;

-- =====================================================================
-- PASO 0 — Las compras también son de prueba
-- =====================================================================
-- Confirmado por el usuario 2026-10-04, después de ver el detalle de las
-- compras cargadas: todo lo que hay es de prueba. Con borrar_compras =
-- true se borran compras, items, recepciones, historial de costos y
-- reclasificaciones fiscales; el costo_actual de cada SKU queda en blanco
-- y se vuelve a cargar al contar.
--
-- Queda como interruptor y no hardcodeado por una sola razón: si al correr
-- el script el informe final no cierra y hay que hacer rollback, poner
-- false acá permite repetir la limpieza conservando compras sin tocar nada
-- más del script.

create temporary table _cfg on commit drop as
  select true as borrar_compras;   -- <<<<<< true = las compras tambien son de prueba

-- =====================================================================
-- PASO 1 — Qué SKU se intentan borrar del catálogo
-- =====================================================================
-- Únicamente los que ya sacaste con la X y quedaron dados de baja
-- (activo = false) porque tenían operaciones colgadas. Son los que
-- desaparecieron de la pantalla pero siguen en la base.
--
-- NO se usa "no tiene código de barras" como criterio (corrección del
-- usuario 2026-10-04): hay productos reales cargados sin código, porque no
-- todo viene con EAN. Un SKU sin código no es un SKU de prueba.
--
-- Los del catálogo de ejemplo que vino con el sistema (Quilmes, Branca,
-- Gordon's) tampoco se tocan acá: si alguno sobra, se saca con la X desde
-- Productos. Después de esta limpieza no van a tener historia, así que la
-- X los va a borrar de verdad en vez de esconderlos.
--
-- "Se intentan": al final solo se borran los que queden sin ninguna
-- referencia. El resto sigue dado de baja, que ya es invisible en el
-- catálogo y en el punto de venta.

create temporary table _skus_a_borrar on commit drop as
  select id from skus where not activo;

-- =====================================================================
-- PASO 2 — Desactivar los bloqueos y las validaciones de edición
-- =====================================================================
-- Son las 23 tablas que tienen algún trigger que corre en DELETE: los
-- *_bloquear_escritura_directa (stock, ventas, caja, movimientos) y los
-- *_validar_edicion de pedido_items, compra_items y recepcion_items, que
-- rechazan tocar los items de un documento ya enviado o confirmado.
-- Las claves foráneas siguen activas: el orden de borrado de abajo tiene
-- que ser correcto o la transacción falla. Eso es a propósito — si falta
-- una tabla, que explote, no que queden huérfanos. Por eso NO se usa
-- session_replication_role = replica, que apagaría también las FK.

alter table stock_sucursal                 disable trigger user;
alter table movimientos_stock              disable trigger user;
alter table historial_costos               disable trigger user;
alter table transferencias                 disable trigger user;
alter table transferencia_items            disable trigger user;
alter table stock_transito                 disable trigger user;
alter table stock_envases                  disable trigger user;
alter table movimientos_envases            disable trigger user;
alter table cajas                          disable trigger user;
alter table ventas                         disable trigger user;
alter table venta_items                    disable trigger user;
alter table venta_pagos                    disable trigger user;
alter table devoluciones                   disable trigger user;
alter table devolucion_items               disable trigger user;
alter table devolucion_cambio_items        disable trigger user;
alter table comprobantes_fiscales          disable trigger user;
alter table comprobantes_fiscales_items    disable trigger user;
alter table movimientos_caja               disable trigger user;
alter table compras_reclasificacion_fiscal disable trigger user;
alter table mermas                         disable trigger user;
-- Estas tres no bloquean la escritura: validan la edicion segun el estado
-- del documento (un pedido ya enviado, una compra confirmada). Tambien
-- corren en DELETE, asi que frenan la limpieza.
alter table pedido_items                   disable trigger user;
alter table compra_items                   disable trigger user;
alter table recepcion_items                disable trigger user;

-- =====================================================================
-- PASO 3 — Facturación ARCA (homologación)
-- =====================================================================
-- Comprobantes de prueba contra wswhomo. Si alguno tiene CAE, es un CAE de
-- homologación y no tiene valor fiscal. El token cacheado (arca_ta_cache)
-- no se toca: no es un dato de negocio, se renueva solo.

delete from comprobantes_fiscales_items;
delete from comprobantes_fiscales;

-- =====================================================================
-- PASO 4 — Devoluciones de cliente
-- =====================================================================

delete from devolucion_cambio_items;
delete from devolucion_items;
delete from devoluciones;

-- =====================================================================
-- PASO 5 — Ventas
-- =====================================================================

delete from venta_pagos;
delete from venta_items;
delete from ventas;

-- =====================================================================
-- PASO 6 — Caja
-- =====================================================================

delete from movimientos_caja;
delete from cajas;

-- =====================================================================
-- PASO 7 — Promociones
-- =====================================================================
-- Decisión del usuario 2026-10-04: las promociones cargadas son de prueba,
-- los precios no.

delete from promocion_items;
delete from promociones;

-- =====================================================================
-- PASO 8 — Envases retornables
-- =====================================================================
-- El stock de vacíos también se cuenta de cero.

delete from movimientos_envases;
update stock_envases set cantidad_vacios = 0 where cantidad_vacios <> 0;

-- =====================================================================
-- PASO 9 — Transferencias y pedidos entre sucursales
-- =====================================================================
-- Primero transferencias: transferencia_items apunta a pedido_items.

delete from stock_transito;
delete from transferencia_items;
delete from transferencias;
delete from pedido_items;
delete from pedidos;

-- Pedido de compra semanal de Olavarría al dueño. No mueve stock, es una
-- lista de reposición: si quedó alguna pendiente de las pruebas, se vuelve
-- a armar en dos minutos.
delete from pedidos_compra_items;
delete from pedidos_compra;

-- =====================================================================
-- PASO 10 — Inventarios y mermas
-- =====================================================================
-- inventario_items apunta al movimiento de ajuste, así que va antes que
-- movimientos_stock.

delete from inventario_items;
delete from inventarios;
delete from mermas;

-- =====================================================================
-- PASO 11 — Carga inicial de stock
-- =====================================================================
-- Se rehace entera después de contar depósito y góndola, así que se borra
-- siempre, independientemente de lo que se decida sobre las compras. Sus
-- filas de historial de costos se distinguen por carga_inicial_id.

delete from historial_costos where carga_inicial_id is not null;
delete from cargas_iniciales;

-- =====================================================================
-- PASO 12 — Compras (solo si borrar_compras = true)
-- =====================================================================
-- Si borrar_compras es false, estos DELETE no borran ninguna fila: el
-- predicado es constante falso.

delete from compras_reclasificacion_fiscal where (select borrar_compras from _cfg);
delete from historial_costos                where (select borrar_compras from _cfg);
delete from recepcion_items                 where (select borrar_compras from _cfg);
delete from recepciones_compra              where (select borrar_compras from _cfg);
delete from compra_items                    where (select borrar_compras from _cfg);
delete from compras                         where (select borrar_compras from _cfg);

-- =====================================================================
-- PASO 13 — Movimientos de stock
-- =====================================================================
-- Se borra todo movimiento que no esté respaldado por una recepción de
-- compra que haya sobrevivido al paso 12. Una sola regla para los dos
-- casos:
--   - borrar_compras = true  -> no quedó ninguna recepción, se borra todo.
--   - borrar_compras = false -> quedan los movimientos de las compras
--     reales, y se van ventas, ajustes, desarmes, mermas, transferencias,
--     inventarios y carga inicial.

delete from movimientos_stock m
 where m.documento_tipo is distinct from 'recepcion_compra'
    or not exists (
      select 1 from recepciones_compra r where r.id = m.documento_id
    );

-- =====================================================================
-- PASO 14 — Stock = suma de los movimientos que quedaron
-- =====================================================================
-- Regla 1 de CLAUDE.md: si no hay movimiento, no hay stock. Después de
-- borrar movimientos, la única cantidad coherente es la suma de los que
-- sobrevivieron. Si no sobrevivió ninguno, queda en cero.
--
-- Nota: los stock_anterior / stock_posterior de los movimientos que quedan
-- siguen diciendo lo que decían cuando se registraron. Es inevitable al
-- borrar historia y es parte del precio de este reseteo.

update stock_sucursal ss
   set cantidad = coalesce((
         select sum(m.cantidad)
           from movimientos_stock m
          where m.sku_id = ss.sku_id
            and m.sucursal_id = ss.sucursal_id
       ), 0)
 where ss.cantidad <> coalesce((
         select sum(m.cantidad)
           from movimientos_stock m
          where m.sku_id = ss.sku_id
            and m.sucursal_id = ss.sucursal_id
       ), 0);

-- =====================================================================
-- PASO 15 — Costo actual
-- =====================================================================
-- costo_actual es el costo del último lote recibido. Si al SKU no le quedó
-- ninguna fila de historial de costos, no hay último lote: queda en blanco
-- y se carga al contar.

update skus s
   set costo_actual = null
 where s.costo_actual is not null
   and not exists (select 1 from historial_costos h where h.sku_id = s.id);

-- =====================================================================
-- PASO 16 — Qué SKU quedaron realmente libres para borrar
-- =====================================================================

create temporary table _skus_libres on commit drop as
  select b.id
    from _skus_a_borrar b
   where not exists (select 1 from movimientos_stock       t where t.sku_id = b.id)
     and not exists (select 1 from venta_items             t where t.sku_id = b.id)
     and not exists (select 1 from compra_items            t where t.sku_id = b.id)
     and not exists (select 1 from recepcion_items         t where t.sku_id = b.id)
     and not exists (select 1 from historial_costos        t where t.sku_id = b.id)
     and not exists (select 1 from inventario_items        t where t.sku_id = b.id)
     and not exists (select 1 from mermas                  t where t.sku_id = b.id)
     and not exists (select 1 from pedido_items            t where t.sku_id = b.id)
     and not exists (select 1 from pedidos_compra_items    t where t.sku_id = b.id)
     and not exists (select 1 from transferencia_items     t where t.sku_id = b.id)
     and not exists (select 1 from stock_transito          t where t.sku_id = b.id)
     and not exists (select 1 from devolucion_cambio_items t where t.sku_id = b.id)
     and not exists (select 1 from promocion_items         t where t.sku_id = b.id);

-- Los que NO quedaron libres siguen dados de baja: es el caso del SKU que
-- aparece en una compra real que se decidió conservar. No se borra, pero
-- queda fuera del catálogo y del punto de venta. El bloque 4 de
-- 03-verificacion.sql los lista con el motivo.

-- =====================================================================
-- PASO 17 — Borrar los SKU libres y su configuración
-- =====================================================================
-- Precio, override por sucursal, recargo, proveedor y la fila de stock son
-- configuración del SKU, no historia: se van con él.

-- La cascada de desarme (x24 -> x6 -> unidad) referencia SKU entre sí.
-- Desvincular antes de borrar, incluso en los que sobreviven.
update skus
   set desarma_en_sku_id = null,
       desarma_en_cantidad = null
 where desarma_en_sku_id in (select id from _skus_libres);

delete from precios          where sku_id in (select id from _skus_libres);
delete from precios_sucursal where sku_id in (select id from _skus_libres);
delete from recargos_sku     where sku_id in (select id from _skus_libres);
delete from proveedor_skus   where sku_id in (select id from _skus_libres);
delete from stock_sucursal   where sku_id in (select id from _skus_libres);
delete from skus             where id     in (select id from _skus_libres);

-- =====================================================================
-- PASO 18 — Productos que quedaron sin ningún SKU
-- =====================================================================
-- El producto solo agrupa SKU para la búsqueda (CLAUDE.md regla 4): si no
-- le quedó ninguno, no representa nada.
--
-- Marcas y categorías NO se tocan: la lista de categorías la mantenés vos
-- y las marcas las vas a volver a usar al codificar cerveza y gaseosas.

delete from productos p
 where not exists (select 1 from skus s where s.producto_id = p.id);

-- =====================================================================
-- PASO 19 — Volver a prender los bloqueos
-- =====================================================================

alter table stock_sucursal                 enable trigger user;
alter table movimientos_stock              enable trigger user;
alter table historial_costos               enable trigger user;
alter table transferencias                 enable trigger user;
alter table transferencia_items            enable trigger user;
alter table stock_transito                 enable trigger user;
alter table stock_envases                  enable trigger user;
alter table movimientos_envases            enable trigger user;
alter table cajas                          enable trigger user;
alter table ventas                         enable trigger user;
alter table venta_items                    enable trigger user;
alter table venta_pagos                    enable trigger user;
alter table devoluciones                   enable trigger user;
alter table devolucion_items               enable trigger user;
alter table devolucion_cambio_items        enable trigger user;
alter table comprobantes_fiscales          enable trigger user;
alter table comprobantes_fiscales_items    enable trigger user;
alter table movimientos_caja               enable trigger user;
alter table compras_reclasificacion_fiscal enable trigger user;
alter table mermas                         enable trigger user;
-- Y las tres validaciones de edicion.
alter table pedido_items                   enable trigger user;
alter table compra_items                   enable trigger user;
alter table recepcion_items                enable trigger user;

-- =====================================================================
-- PASO 20 — Informe antes de confirmar
-- =====================================================================

select
  (select count(*) from ventas)                             as ventas,
  (select count(*) from movimientos_stock)                  as movimientos,
  (select count(*) from stock_sucursal where cantidad <> 0)  as filas_con_stock,
  (select count(*) from compras)                            as compras,
  (select count(*) from skus where activo)                  as skus_activos,
  (select count(*) from skus where not activo)              as skus_de_baja,
  (select count(*) from productos)                          as productos,
  (select count(*) from precios)                            as precios;

-- =====================================================================
-- Si el informe tiene sentido:   commit;
-- Si algo no cierra:             rollback;
--
-- Nada queda aplicado hasta que escribas uno de los dos.
-- =====================================================================
