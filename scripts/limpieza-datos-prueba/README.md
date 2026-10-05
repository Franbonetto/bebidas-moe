# Limpieza de datos de prueba (2026-10-04)

Reseteo previo a la puesta en marcha: se borran las ventas ficticias, las
operaciones de prueba y los SKU que quedaron dados de baja porque tenían
movimientos colgados. Se conserva el catálogo cargado a mano, con sus
precios.

**Esto no es una migración.** Vive fuera de `supabase/migrations/` a
propósito: se corre una vez, antes de operar en serio, y no se vuelve a
correr. Para poder borrar movimientos hay que desactivar temporalmente los
triggers que los hacen inmutables (CLAUDE.md regla 2); una vez que el
negocio opere de verdad, la forma de corregir stock es un movimiento de
ajuste, no un DELETE.

## Orden

1. **`01-diagnostico.sql`** — solo lectura. Seis bloques para ver qué hay
   antes de borrar. Ya corrido el 2026-10-04: 63 movimientos de stock (48
   de venta, 9 de compra, 2 de ajuste, 4 de desarme), sin inventarios,
   mermas, transferencias ni carga inicial.
2. **`02-limpieza.sql`** — el borrado. Sacar un backup en Supabase
   (Database > Backups) antes. El interruptor `borrar_compras` del PASO 0
   ya está en `true`: el usuario confirmó el 2026-10-04 que las compras
   cargadas también eran de prueba.

   Corre entero dentro de una transacción y termina con un informe, sin
   `commit`. Si el informe cierra, escribir `commit;`. Si no, `rollback;`.
3. **`03-verificacion.sql`** — solo lectura, después del commit. Los
   bloques 1 a 3 tienen que dar OK / cero filas.

## Qué queda después

- Catálogo: todo lo que hoy se ve en Productos queda igual. Solo se van
  los SKU que ya habías sacado con la X y quedaron escondidos. Tener o no
  código de barras no se usa como criterio: hay productos reales sin EAN.
- Stock: en cero, todo. Se carga de verdad con **Carga inicial** después
  de contar depósito y góndola.
- Precios base y recargos por categoría: intactos.
- Costos: en blanco. El primer costo entra al contar o con la primera
  compra real.
- Caja: sin cajas abiertas. La primera venta real abre una nueva.
