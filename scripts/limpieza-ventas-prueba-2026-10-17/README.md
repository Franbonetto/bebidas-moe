# Limpieza de las ventas de prueba (2026-10-17)

Último reseteo antes de la puesta en marcha: se van **las 18 ventas de
prueba** que hay en el sistema (08, 12, 14 y 16/10) y las 9 cajas, todas
abiertas y sin cerrar.

**Esto no es una migración.** Vive fuera de `supabase/migrations/` a
propósito: se corre una vez, hoy, antes de operar de verdad. Para borrar
movimientos hay que desactivar temporalmente los triggers que los hacen
inmutables (CLAUDE.md regla 2). **A partir de hoy esto deja de ser
aceptable:** la forma de corregir stock pasa a ser un movimiento de
ajuste, nunca un DELETE.

## El reseteo del 15/10 nunca se aplicó

`scripts/limpieza-ventas-cajas/` tiene un README que dice que se corrió y
que el informe cerró, pero **las 14 ventas del 08 al 14/10 siguen en la
base**. El `commit;` final no se llegó a escribir, o se hizo `rollback`.
No pueden ser ventas nuevas: el POS estampa `now()` en cada una, así que
nadie puede crear una con fecha del 08.

Por eso este script las incluye, y por eso el informe del PASO 13 no se
confirma hasta que cierre.

## Lo que NO se toca

**Los 63 ajustes de la venta en papel del 15/10**
(`scripts/ventas-papel-2026-10-15/`, −165 unidades). Esa mercadería salió
de verdad del mostrador: se vendió y se anotó a mano. Revertirla sería
inventar stock que no está en el local.

El script borra los movimientos **por documento** (`documento_tipo =
'venta'`), y la venta en papel son ajustes sin documento: no pueden entrar
ni por error. El PASO 12 además los cuenta antes y después y aborta si el
número cambió.

Tampoco se tocan el conteo de la carga inicial (7.398 unidades contadas a
mano), el catálogo, los precios, las promociones, las compras ni —si para
cuando lo corras ya existe— la venta o la caja de **hoy**.

## El stock: no se repone todo

Decisión del usuario: *"si tienen fecha de antes de anteayer esas no
reponen stock, solo las de ayer y anteayer reponen porque ya estaba
contado"*.

La razón está en [`cargar_stock_inicial()`](../../supabase/migrations/20260929090000_carga_inicial_stock.sql):
**no suma, fija** (`v_delta := p_cantidad - v_stock_actual`). Si un SKU
quedó en −9 por una venta del 08/10 y después alguien contó 52 en la
góndola, la carga inicial escribió **+61** para llegar a 52. El conteo ya
absorbió la venta falsa: reponer esos 9 dejaría 61 donde hay 52.

El script aplica esa regla **por producto y no por fecha**, comparando
cada movimiento de venta con el último conteo de ese SKU:

| caso | qué pasa |
|---|---|
| **PENDIENTE** — la venta es posterior al conteo, o el SKU nunca se contó | La venta falsa todavía resta del stock de hoy: se devuelven las unidades |
| **ABSORBIDO** — la venta es anterior al conteo | El stock de hoy ya es el número contado y no se toca. Se corrige el movimiento de la carga inicial, que deja de decir "+61" y pasa a decir "+52" |

En la práctica da lo que pediste —las viejas no reponen, las de ayer sí—
pero lo decide el dato. Si entre las viejas hay un SKU que nunca se contó,
se repone igual (si no, quedaría negativo sin ningún movimiento que lo
explique). El informe dice qué se hizo con cada uno.

### Por qué se corrige el conteo y no se agrega un ajuste

Un ajuste nuevo de −9 con motivo "corrección de prueba" dejaría el primer
día de operación real con un conteo de +61 que nadie contó nunca.
Corrigiendo el movimiento, el historial queda diciendo la verdad: se
contaron 52. Es editar historia, igual que borrar las ventas — y hoy es el
último día en que eso es aceptable.

## Las fechas se leen en hora de Argentina

Siempre con `at time zone 'America/Argentina/Buenos_Aires'`, nunca en UTC.
Una venta de las 23:19 del 16 figura en UTC como del **17**: filtrando por
UTC esa venta ficticia se salvaría, y una venta real de hoy a la madrugada
se borraría.

El alcance es "todo lo anterior a hoy", no una lista de fechas: si entre
el diagnóstico y la limpieza se hace una venta real, queda afuera sola.

## Orden

1. **`01-diagnostico.sql`** — solo lectura. Ya corrido el 2026-10-17.
2. **`01b-orden-de-los-conteos.sql`** — solo lectura, opcional pero
   recomendado: dice producto por producto si se repone o si el conteo ya
   lo absorbió, y con qué stock termina cada uno.
3. **Backup** en Supabase (Database > Backups).
4. **`02-limpieza.sql`** — corre entero en una transacción y termina con
   un informe que se compara solo contra la foto del antes. Si cierra,
   escribir `commit;`. Si no, `rollback;`.

   **Hay que editar una línea**: el PASO 2 se detiene porque entre las
   ventas hay una Factura A autorizada (nro 6, CAE 86421002366466,
   $10.000). Es de homologación (`ARCA_ENTORNO=homologacion`), así que no
   tiene valor fiscal. Para seguir, cambiar `select false as ok` por
   `select true as ok` en `_confirmo_homologacion`.

## Las guardas que abortan la transacción

- **PASO 2:** comprobantes autorizados sin confirmar. Borrar la fila local
  de una factura **real** no la anula en ARCA: para eso va una nota de
  crédito.
- **PASO 3:** falta una fila de `stock_sucursal` para algo a reponer, o
  hay algo marcado como absorbido sin conteo que lo absorba.
- **PASO 10:** quedó alguna caja vieja con ventas colgando.
- **PASO 12:** cinco verificaciones — stock de cada SKU igual a la suma de
  sus movimientos, venta en papel intacta, el total movido **exactamente**
  lo pendiente (ni una unidad de más), sin ventas viejas sobrevivientes, y
  sin stock negativo nuevo.

## Sobre el stock negativo

Puede seguir habiendo filas en negativo, y está bien: son SKU que todavía
no se contaron y que tienen encima la venta en papel. Se corrigen contando
ese SKU, no borrando el movimiento. Lo que el script garantiza es que el
negativo **no crezca**.
