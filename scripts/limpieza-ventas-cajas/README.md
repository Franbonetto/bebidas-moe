# Limpieza de ventas y cajas de prueba (2026-10-15)

> **ESTE SCRIPT NUNCA SE APLICO.** Lo de abajo dice que se corrio y que el
> informe cerro, pero el `commit;` final no se llego a escribir: el
> 2026-10-17 las 14 ventas del 08 al 14/10 seguian en la base, con sus 9
> cajas y 3 comprobantes. Lo verificado el 2026-10-15 fue el informe
> **dentro de la transaccion**, que es lo que se ve antes de confirmar.
>
> La limpieza de verdad la hizo
> `scripts/limpieza-ventas-prueba-2026-10-17/`, que ademas tuvo que
> resolver algo que aca no existia: entre medio se conto casi todo el
> catalogo, y como `cargar_stock_inicial()` FIJA el stock en vez de
> sumarlo, el conteo posterior ya habia absorbido esas ventas falsas.
>
> Lo de abajo queda como registro de lo que se penso aquel dia. **No
> correrlo.**

Segundo reseteo, distinto del de octubre. Esta vez **el catálogo y la carga
inicial se conservan enteros**: se van solo las ventas, las cajas y lo que
cuelga de ellas (devoluciones, comprobantes, movimientos de caja y los
movimientos de stock de venta).

**Esto no es una migración.** Vive fuera de `supabase/migrations/` a
propósito: se corre una vez, antes de operar en serio, y no se vuelve a
correr. Para poder borrar movimientos hay que desactivar temporalmente los
triggers que los hacen inmutables (CLAUDE.md regla 2); una vez que el
negocio opere de verdad, la forma de corregir stock es un movimiento de
ajuste, no un DELETE.

## Orden

1. **`01-diagnostico.sql`** — solo lectura. Es **una sola consulta** que
   devuelve los ocho bloques en una tabla: el SQL Editor de Supabase
   muestra solo el resultado del último statement, así que ocho consultas
   sueltas devolvían solo la última.

   Corrido el 2026-10-15. Lo que mostró: 14 ventas (08 al 14/10), 7 cajas
   todas abiertas, 1 comprobante de homologación, y ni desarmes, ni
   mermas, ni inventarios, ni compras, ni movimientos de envases. El
   comprobante es de homologación (`ARCA_ENTORNO=homologacion`), así que
   su CAE no tiene valor fiscal.
2. **Backup** en Supabase (Database > Backups).
3. **`02-limpieza.sql`** — el borrado. Corre entero en una transacción y
   termina con un informe, sin `commit`. Si el informe cierra, escribir
   `commit;`. Si no, `rollback;`.

   Tiene dos guardas que abortan la transacción:
   - **PASO 1:** si aparece algún comprobante fiscal distinto al único que
     verificamos (Factura B nro 15, CAE 86410968927840, de homologación).
   - **PASO 12:** si queda stock negativo, si el stock de algún SKU no
     coincide con la suma de sus movimientos, o si sobrevivió alguna venta
     o caja.

## El stock: solo se tocan los 4 que no se contaron

El pedido original fue no reponer nada ("era ficticio eso"), y la razón
era no inflar lo contado a mano. El diagnóstico mostró que esa duda no
aplica: de los 108 SKU con stock, **solo 4 tienen ventas, y los 4 están
sin contar**. Su stock negativo es exactamente las ventas ficticias.

```
FERNET-BRANCA-750        Olavarría  -8
GASEOSA-COCACOLA-2250    Olavarría  -9
GIN-CORDILLERA-PINK-750  Olavarría  -4
GIN-ACONCAGUA-ROSA-750   Laprida    -1
                                   ────
                                    -22
```

Decisión del 2026-10-15: esos 4 van a **cero**. No es reponer de más —
nunca se contaron, antes de las pruebas estaban en cero y ahí vuelven. Los
104 SKU contados no tienen ninguna venta encima y no se tocan.

Dejarlos en negativo era la alternativa, y se descartó: el POS advierte en
cada venta, quedan marcados para revisión de inventario y aparecen en las
alertas del dueño.

La regla está en SQL y no con los 4 códigos a mano: se revierten las
ventas de los SKU **sin movimiento de carga inicial**. Si alguno se cuenta
antes de correr el script, deja de tocarlo solo.

Resultado: stock total 966, igual que la carga inicial, y el historial de
movimientos vuelve a explicar el stock exactamente. El **PASO 12 lo
verifica y aborta la transacción** si no cierra.

## Resultado (corrido y confirmado el 2026-10-15)

Corrido por el usuario. El informe del PASO 13 cerró y el PASO 12 pasó las
tres verificaciones, que es la prueba real de que el inventario quedó
consistente: sin stock negativo, **el stock de cada SKU igual a la suma de
sus movimientos**, y sin ventas ni cajas sobrevivientes.

```
                                 informe   esperado
ventas / cajas / comprobantes          0          0
movimientos de venta                   0          0
SKU activos                         1014       1014
productos                            952        952
promociones                            4          4
movimientos de carga inicial         113        107   (+6)
precios base                         290        284   (+6)
filas con stock                      106        100   (+6)
unidades en stock                    989        966  (+23)
stock negativo                         0          0
```

Las cuatro diferencias son del usuario, no del script: contó **6 productos
más** entre el diagnóstico y la limpieza. Los cuatro números se mueven
juntos (+6 conteos, +6 precios, +6 filas, +23 unidades) y la cuenta cierra:
966 + 23 = 989. La columna `esperado` se escribió con los números del
diagnóstico y no podía saber de esos 6.

**No volver a correr este script.**

## Qué queda después

- **Catálogo:** intacto. SKU, productos, marcas, categorías, tipos de
  envase, códigos de barras.
- **Carga inicial:** intacta, con su historial de costos y el
  `costo_actual` de cada SKU.
- **Stock:** 989 unidades en 106 filas (966 previstas + 23 de los 6
  productos que se contaron en el medio). Los SKU contados quedan igual;
  los 4 que estaban en negativo por las pruebas quedaron en cero.
- **Precios:** intactos — base, por sucursal, en efectivo, recargos y
  descuentos.
- **Promociones:** intactas (en el reseteo de octubre sí se borraron; acá
  no, porque ahora son las de verdad).
- **Compras, recepciones y costos:** intactos.
- **Inventarios, mermas, pedidos y transferencias:** intactos. Si quedó
  alguno de prueba lo muestra el bloque 8 del diagnóstico, y se decide
  aparte.
- **Caja:** sin ninguna. La primera venta real abre una nueva sola.
