-- =====================================================================
-- LIMPIEZA DE VENTAS Y CAJAS DE PRUEBA — SCRIPT DE UN SOLO USO
-- =====================================================================
--
-- Pedido del usuario 2026-10-15: borrar las ventas y las cajas, que eran
-- todas de prueba, y dejar el sistema listo para operar. SIN tocar nada
-- del catálogo ni de la carga inicial.
--
-- ESTO NO ES UNA MIGRACIÓN. No va en supabase/migrations/ a propósito: es
-- un reseteo previo a la puesta en marcha, se corre una vez y no se vuelve
-- a correr. Una vez que el negocio opere de verdad, borrar movimientos
-- deja de ser aceptable (CLAUDE.md regla 2: los movimientos son
-- inmutables; para corregir stock se genera un ajuste, no un DELETE).
--
-- ---------------------------------------------------------------------
-- LO QUE MOSTRÓ EL DIAGNÓSTICO (corrido el 2026-10-15)
-- ---------------------------------------------------------------------
--   14 ventas del 08 al 14/10, 21 items, 14 pagos, 7 cajas (todas
--   abiertas), 1 comprobante fiscal, 0 devoluciones, 0 movimientos de
--   caja.
--
--   Carga inicial: 107 movimientos, +966 unidades, 14 y 15/10.
--   Ventas:         21 movimientos,  -22 unidades.
--   Stock hoy: 944 = 966 - 22, en 104 filas.
--
--   NO hay desarmes, mermas, inventarios, pedidos, transferencias,
--   compras, recepciones ni movimientos de envases.
--
--   Solo 4 SKU tienen ventas, y los 4 están SIN CONTAR y en negativo
--   justamente por esas ventas ficticias:
--     FERNET-BRANCA-750        Olavarría  -8
--     GASEOSA-COCACOLA-2250    Olavarría  -9
--     GIN-CORDILLERA-PINK-750  Olavarría  -4
--     GIN-ACONCAGUA-ROSA-750   Laprida    -1
--
-- ---------------------------------------------------------------------
-- EL STOCK: SOLO SE TOCAN LOS QUE NO SE CONTARON
-- ---------------------------------------------------------------------
-- El usuario pidió primero no reponer nada ("era ficticio eso"), y la
-- razón era no inflar lo que ya había contado a mano. Visto el
-- diagnóstico, decisión del 2026-10-15: esos 4 SKU se llevan a CERO.
--
-- No es reponer de más: nunca se contaron, así que antes de las pruebas
-- estaban en cero y ahí vuelven. Los 104 SKU contados no tienen ninguna
-- venta encima y no se tocan. El total vuelve a 966, igual que la carga
-- inicial, y el historial de movimientos vuelve a explicar el stock
-- exactamente — el PASO 12 lo verifica y aborta si no cierra.
--
-- La regla está escrita en SQL, no con los 4 códigos a mano: se revierten
-- las ventas de los SKU que NO tienen movimiento de carga inicial. Si
-- entre el diagnóstico y ahora alguien contó uno de esos 4, el script
-- deja de tocarlo solo.
--
-- Correr primero 01-diagnostico.sql. Sacar un backup en Supabase
-- (Database > Backups) antes de esto.
--
-- Todo corre dentro de una transacción y termina con un informe, sin
-- commit. Si el informe cierra, escribir `commit;`. Si no, `rollback;`.
-- Si algo falla en el medio, la transacción se revierte entera y los
-- triggers quedan como estaban: no puede quedar a medias.
--
-- ---------------------------------------------------------------------
-- QUÉ SE BORRA                          QUÉ NO SE TOCA
-- ---------------------------------------------------------------------
-- Ventas, items y pagos                 Catálogo entero (1014 SKU, 952
-- Devoluciones de cliente                 productos, marcas, categorías)
-- Comprobantes fiscales y sus items     Carga inicial y su historial de
-- Cajas y movimientos de caja             costos
-- Movimientos de stock de venta         Stock de los 104 SKU contados
--   y de devolución                     Precios (284 base), recargos,
-- Movimientos de envases de una venta     descuentos, precios efectivo
--                                       Las 4 promociones
--                                       Proveedores, empleados, usuarios
-- ---------------------------------------------------------------------

begin;

-- =====================================================================
-- PASO 1 — Tripwire de facturación
-- =====================================================================
-- El único comprobante que hay es Factura B nro 15, PV 11, CAE
-- 86410968927840, del 08/10, $24.400. Es de HOMOLOGACIÓN: el .env.local
-- del proyecto tiene ARCA_ENTORNO=homologacion, así que ese CAE no tiene
-- valor fiscal y se borra sin consecuencias.
--
-- Si apareciera cualquier otro comprobante — por ejemplo si alguien
-- facturó algo nuevo entre el diagnóstico y ahora — el script se detiene,
-- porque borrar la fila local de una factura real NO la anula en ARCA
-- (para eso va una nota de crédito).

do $$
declare
  v_otros integer;
begin
  select count(*) into v_otros
    from comprobantes_fiscales
   where cae is distinct from '86410968927840';

  if v_otros > 0 then
    raise exception
      'Apareció(eron) % comprobante(s) distinto(s) al verificado en el diagnóstico. Volvé a correr 01-diagnostico.sql y revisá el bloque 7 antes de borrar nada: si alguno se emitió en producción, borrar la fila no anula la factura en ARCA.',
      v_otros;
  end if;
end $$;

-- =====================================================================
-- PASO 2 — Fotos de lo que hay que corregir, ANTES de borrar
-- =====================================================================
-- Después de los DELETE ya no hay de dónde sacarlas.

-- Qué SKU y sucursal tienen conteo de carga inicial. Los que están acá no
-- se tocan: su stock es el que contó el usuario.
create temporary table _contados on commit drop as
  select distinct sku_id, sucursal_id
    from movimientos_stock
   where documento_tipo = 'carga_inicial';

-- Neto de las ventas a revertir, solo de los SKU sin conteo. Los
-- movimientos de venta son negativos, así que restar el neto devuelve las
-- unidades y los deja en cero.
create temporary table _revertir on commit drop as
  select m.sku_id, m.sucursal_id, sum(m.cantidad) as neto
    from movimientos_stock m
   where m.tipo in ('venta', 'devolucion_entrada')
     and not exists (
       select 1 from _contados c
        where c.sku_id = m.sku_id and c.sucursal_id = m.sucursal_id
     )
   group by m.sku_id, m.sucursal_id;

create temporary table _envases_de_ventas on commit drop as
  select tipo_envase_id, sucursal_id, sum(cantidad) as neto
    from movimientos_envases
   where venta_id is not null
   group by tipo_envase_id, sucursal_id;

-- =====================================================================
-- PASO 3 — Desactivar los bloqueos de escritura directa
-- =====================================================================
-- Solo las tablas que toca este script. Las claves foráneas siguen
-- activas a propósito: si el orden de borrado está mal, que explote en
-- vez de dejar huérfanos (por eso NO se usa session_replication_role).

alter table ventas                      disable trigger user;
alter table venta_items                 disable trigger user;
alter table venta_pagos                 disable trigger user;
alter table cajas                       disable trigger user;
alter table movimientos_caja            disable trigger user;
alter table devoluciones                disable trigger user;
alter table devolucion_items            disable trigger user;
alter table devolucion_cambio_items     disable trigger user;
alter table comprobantes_fiscales       disable trigger user;
alter table comprobantes_fiscales_items disable trigger user;
alter table movimientos_stock           disable trigger user;
alter table stock_sucursal              disable trigger user;
alter table movimientos_envases         disable trigger user;
alter table stock_envases               disable trigger user;

-- =====================================================================
-- PASO 4 — Comprobantes fiscales
-- =====================================================================
-- Van primero: comprobantes_fiscales_items apunta a venta_items y
-- comprobantes_fiscales a ventas.

delete from comprobantes_fiscales_items;
delete from comprobantes_fiscales;

-- El token de ARCA (arca_ta_cache) no se toca: no es un dato de negocio,
-- se renueva solo cada 12 horas.

-- =====================================================================
-- PASO 5 — Devoluciones de cliente
-- =====================================================================
-- El diagnóstico dio 0: estos DELETE no borran nada. Quedan por si acaso.

delete from devolucion_cambio_items;
delete from devolucion_items;
delete from devoluciones;

-- =====================================================================
-- PASO 6 — Ventas
-- =====================================================================

delete from venta_pagos;
delete from venta_items;
delete from ventas;

-- =====================================================================
-- PASO 7 — Cajas
-- =====================================================================
-- Las 7 están abiertas y ninguna llegó a cerrarse. Sin cajas, la primera
-- venta real abre una nueva sola: no hay botón de abrir caja
-- (arquitectura.md 1.8).

delete from movimientos_caja;
delete from cajas;

-- =====================================================================
-- PASO 8 — Movimientos de stock de esas ventas
-- =====================================================================
-- Solo los que salen de una venta. Los 107 de carga inicial quedan
-- intactos. No hay desarmes ni otros tipos (diagnóstico, bloque 3).

delete from movimientos_stock
 where tipo in ('venta', 'devolucion_entrada');

-- =====================================================================
-- PASO 9 — Los 4 SKU sin contar vuelven a cero
-- =====================================================================
-- Restar el neto: los movimientos de venta son negativos, así que esto
-- suma las unidades de vuelta. Los SKU contados no están en _revertir.

update stock_sucursal ss
   set cantidad = ss.cantidad - r.neto
  from _revertir r
 where r.sku_id = ss.sku_id
   and r.sucursal_id = ss.sucursal_id
   and r.neto <> 0;

-- =====================================================================
-- PASO 10 — Envases vacíos que hubieran entrado por esas ventas
-- =====================================================================
-- El diagnóstico no mostró ningún movimiento de envases, así que esto no
-- hace nada. Queda porque si hubiera alguno, una venta de prueba con "Con
-- envase" tildado sumó vacíos que nunca entraron al local y hay que
-- restarlos.

delete from movimientos_envases where venta_id is not null;

update stock_envases se
   set cantidad_vacios = se.cantidad_vacios - r.neto
  from _envases_de_ventas r
 where r.tipo_envase_id = se.tipo_envase_id
   and r.sucursal_id = se.sucursal_id
   and r.neto <> 0;

-- =====================================================================
-- PASO 11 — Volver a prender los bloqueos
-- =====================================================================

alter table ventas                      enable trigger user;
alter table venta_items                 enable trigger user;
alter table venta_pagos                 enable trigger user;
alter table cajas                       enable trigger user;
alter table movimientos_caja            enable trigger user;
alter table devoluciones                enable trigger user;
alter table devolucion_items            enable trigger user;
alter table devolucion_cambio_items     enable trigger user;
alter table comprobantes_fiscales       enable trigger user;
alter table comprobantes_fiscales_items enable trigger user;
alter table movimientos_stock           enable trigger user;
alter table stock_sucursal              enable trigger user;
alter table movimientos_envases         enable trigger user;
alter table stock_envases               enable trigger user;

-- =====================================================================
-- PASO 12 — Auto-verificación: si algo no cierra, aborta
-- =====================================================================
-- Tres cosas que tienen que ser verdad al terminar. Si alguna falla, la
-- transacción se cae entera y no hace falta que mires nada: no quedó
-- aplicado.

do $$
declare
  v_negativos integer;
  v_descuadrados integer;
  v_detalle text;
begin
  -- 1. Ningún stock negativo.
  select count(*) into v_negativos from stock_sucursal where cantidad < 0;
  if v_negativos > 0 then
    raise exception 'Quedaron % fila(s) de stock en negativo. No debería pasar: rollback.', v_negativos;
  end if;

  -- 2. El stock de cada SKU tiene que ser exactamente la suma de sus
  --    movimientos. Es la regla 1 de CLAUDE.md, y al borrar historia es
  --    justo lo que se puede romper: si no cierra, no se confirma.
  select count(*), string_agg(ss.sku_id::text || ' ' || ss.cantidad::text, ', ')
    into v_descuadrados, v_detalle
    from stock_sucursal ss
   where ss.cantidad <> coalesce((
           select sum(m.cantidad) from movimientos_stock m
            where m.sku_id = ss.sku_id and m.sucursal_id = ss.sucursal_id
         ), 0);

  if v_descuadrados > 0 then
    raise exception
      'Hay % fila(s) donde el stock no coincide con la suma de sus movimientos: %. Rollback.',
      v_descuadrados, left(v_detalle, 500);
  end if;

  -- 3. No puede quedar ninguna venta ni caja.
  if (select count(*) from ventas) > 0 or (select count(*) from cajas) > 0 then
    raise exception 'Quedaron ventas o cajas sin borrar. Rollback.';
  end if;

  raise notice 'Verificación OK: sin stock negativo, stock = suma de movimientos, sin ventas ni cajas.';
end $$;

-- =====================================================================
-- PASO 13 — Informe antes de confirmar
-- =====================================================================
-- Una sola consulta: el SQL Editor muestra solo el último resultado.
-- Lo esperado según el diagnóstico está en la columna de la derecha.

select * from (
            select 10 as orden, 'ventas'              as concepto, count(*)::text as valor, '0' as esperado from ventas
  union all select 11, 'cajas',                         count(*)::text, '0'    from cajas
  union all select 12, 'comprobantes',                  count(*)::text, '0'    from comprobantes_fiscales
  union all select 13, 'movimientos de venta',          count(*)::text, '0'    from movimientos_stock
                                                         where tipo in ('venta', 'devolucion_entrada')
  union all select 20, 'SKU activos',                   count(*)::text, '1014' from skus where activo
  union all select 21, 'productos',                     count(*)::text, '952'  from productos
  union all select 22, 'precios base',                  count(*)::text, '284'  from precios
  union all select 23, 'promociones',                   count(*)::text, '4'    from promociones
  union all select 24, 'cargas iniciales',              count(*)::text, '1'    from cargas_iniciales
  union all select 25, 'movimientos de carga inicial',  count(*)::text, '107'  from movimientos_stock
                                                         where documento_tipo = 'carga_inicial'
  union all select 26, 'UNIDADES EN STOCK',             coalesce(sum(cantidad)::text, '0'), '966' from stock_sucursal
  -- Bajan de 104 a 100: los 4 SKU en negativo pasan a cero y dejan de contar.
  union all select 27, 'filas con stock',               count(*)::text, '100'  from stock_sucursal where cantidad <> 0
  union all select 28, 'stock negativo',                count(*)::text, '0'    from stock_sucursal where cantidad < 0
  union all select 29, 'historial de costos',           count(*)::text, '1'    from historial_costos
) t order by orden;

-- =====================================================================
-- Si el informe cierra contra la columna "esperado":   commit;
-- Si algo no cierra:                                   rollback;
--
-- Nada queda aplicado hasta que escribas uno de los dos.
-- =====================================================================
