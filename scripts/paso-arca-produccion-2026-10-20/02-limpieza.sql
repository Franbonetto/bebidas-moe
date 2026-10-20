-- PASO A PRODUCCIÓN DE ARCA (2026-10-20) — LIMPIEZA
--
-- Borra TODOS los comprobantes fiscales emitidos contra homologación,
-- para arrancar producción con la tabla vacía. Decidido en
-- docs/bloque_arca_facturacion.md sección 7 ("Limpiar
-- comprobantes_fiscales/comprobantes_fiscales_items de datos de
-- homologación antes de arrancar en producción") y confirmado por el
-- usuario el 2026-10-20: las ventas que ya se habían facturado contra
-- homologación quedan como ventas sin factura, igual que las de efectivo.
-- Si alguien pide la factura después, se emite a mano desde
-- /vender/facturar.
--
-- **Esto no es una migración.** Vive fuera de supabase/migrations/ a
-- propósito: se corre una vez, hoy, en el cruce de ambiente. Borrar un
-- comprobante fiscal NO es algo aceptable a partir de mañana: los
-- comprobantes de producción son documentos fiscales reales y la forma de
-- anular uno es una nota de crédito, no un DELETE.
--
-- LAS VENTAS NO SE TOCAN. Ni una fila de ventas, venta_items,
-- venta_pagos, movimientos_stock o cajas. El comprobante siempre fue un
-- registro aparte que referencia a la venta y nunca la modifica
-- (arquitectura.md 1.8, "desacople clave") -- por eso se puede borrar el
-- lado fiscal sin tocar el hecho comercial.
--
-- Efecto colateral esperado y correcto: el balance de IVA del dueño
-- (balance_iva(), migración 20260928090000) deja de contar el IVA de esos
-- comprobantes. Es lo que corresponde: nunca fueron facturas reales, no
-- hay nada que declarar por ellas.
--
-- CORRER TODO JUNTO, de una sola vez: el set_config de abajo es local a
-- la transacción. Si lo corrés por pedazos, el trigger de inmutabilidad
-- rechaza los deletes.

begin;

-- comprobantes_fiscales y comprobantes_fiscales_items tienen un trigger
-- que bloquea toda escritura directa (solo pasa
-- guardar_comprobante_fiscal(), que activa este flag). Acá se activa a
-- mano porque no hay función de borrado: borrar un comprobante no es una
-- operación que el sistema deba poder hacer.
select set_config('bebidas_moe.comprobante_en_curso', 'on', true);

-- Los items caen por `on delete cascade`, pero se borran explícito para
-- que el conteo quede a la vista en el informe de abajo.
with borrados as (
  delete from comprobantes_fiscales_items returning 1
)
select count(*) as items_borrados from borrados;

with borrados as (
  delete from comprobantes_fiscales returning 1
)
select count(*) as comprobantes_borrados from borrados;

-- Cache del Ticket de Acceso de WSAA. La migración
-- 20261020090000_arca_ta_cache_entorno.sql ya recrea la tabla vacía y le
-- agrega el ambiente a la clave, así que esto es por si la limpieza se
-- corre sin haber aplicado todavía esa migración: sin esto, el token de
-- homologación (vive 12hs) se seguiría mandando a los servidores reales
-- de ARCA.
delete from arca_ta_cache;

-- =========================================================
-- Informe: tiene que dar todo en cero, y las ventas intactas.
-- =========================================================

select 'comprobantes_fiscales' as tabla, count(*) as filas from comprobantes_fiscales
union all
select 'comprobantes_fiscales_items', count(*) from comprobantes_fiscales_items
union all
select 'arca_ta_cache', count(*) from arca_ta_cache
union all
select 'ventas confirmadas (NO se tocan)', count(*) from ventas where estado = 'confirmada'
union all
select 'movimientos_stock (NO se tocan)', count(*) from movimientos_stock;

-- Si el informe es el esperado:
commit;

-- Si algo no cuadra, en vez del commit:
-- rollback;
