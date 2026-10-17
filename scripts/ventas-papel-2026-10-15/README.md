# Ventas en papel del 2026-10-15 (Olavarría)

64 líneas / 166 unidades que se vendieron en el mostrador de Olavarría y se
anotaron en papel, sin pasar por el POS. Hay que descontarlas del stock.

**Esto no es una migración.** Es una corrección puntual, de un solo uso, y
vive fuera de `supabase/migrations/` por eso. Tampoco toca ningún trigger:
el descuento se hace con `registrar_movimiento()`, el único camino para
cambiar stock (CLAUDE.md regla 1).

## Decisiones tomadas (2026-10-16)

- **Sucursal:** Olavarría. En el script se resuelve por `es_central`, no
  por nombre, igual que el resto del proyecto.
- **Tipo de movimiento: `ajuste`, con motivo.** Es lo que la regla 2
  define para corregir stock. Un movimiento `venta` sin `documento_id`
  dejaría 64 ventas fantasma, sin fila en `ventas`, sin ticket y sin caja
  detrás: cualquier reporte que cruce movimientos con ventas deja de
  cerrar. El motivo es `Venta en papel del 2026-10-15` y queda en cada
  movimiento.
- **No se registra plata.** El pedido era descontar stock. No se crean
  ventas, ni caja, ni comprobantes.
- **Los dos pack x6** (Heineken 2, Schneider 1) descuentan el SKU del pack,
  no las latas sueltas: un pack vendido descuenta un pack (CLAUDE.md,
  desarme de packs). La equivalencia en latas que venía anotada en el papel
  es informativa.
- **"Mix cervecero"** quedó fuera, por indicación del usuario.
- **Equivalencias de nombre** ya resueltas en la lista: Privado
  Tempranillo = Privado Reserva Tempranillo, Alma Mora vino tinto = Alma
  Mora Malbec, Perro Callejero Pinot = Perro Callejero Pinot Noir.
  Trumpeter Malbec (12) y Trumpeter Reserva Malbec (3) van separados.

## Orden

**`02-ajustes.sql`** se pega entero en el SQL Editor y se corre de una. No
hace falta nada más: resuelve los 64 nombres solo, se verifica solo,
commitea solo e imprime el informe de las 64 líneas con el stock antes y
después de cada una.

**`01-diagnostico.sql`** es opcional, para mirar antes de aplicar. Es solo
lectura y **una sola consulta** (el SQL Editor de Supabase muestra solo el
resultado del último statement). Muestra los candidatos de cada nombre y
marca con `SE DESCUENTA` el SKU que el paso 2 va a elegir.

### Cómo resuelve los nombres

La lista está escrita en el idioma del mostrador ("Fernet Branca 1 litro")
y el catálogo en el del sistema ("Fernet Branca 1000cc"), así que el match
es por palabras: se normalizan los dos lados, se cuentan las palabras del
papel que aparecen en marca + producto + nombre del SKU, y suman un punto
el volumen coincidente y la presentación coincidente.

Si dos SKU empatan, el desempate es, en orden:

1. Si el papel no dice "pack" ni "x6", gana la unidad suelta.
2. Gana el que tiene stock contado en Olavarría.
3. Gana el nombre más corto, o sea el que no agrega palabras que el papel
   no tiene: "Trumpeter Malbec" es Trumpeter Malbec, no Trumpeter Reserva
   Malbec.
4. Por código interno, para que el resultado sea siempre el mismo.

El informe marca cada línea que se decidió por desempate (`como`), las que
dejaron el stock bajo cero (`aviso`) y las que cayeron en el mismo SKU que
otra línea (`repetido`). Si alguna eligió mal, se fuerza con su código
interno en la tabla `ELECCIONES` del paso 2 y se corre de nuevo — la
corrección es un ajuste nuevo, nunca borrar el movimiento anterior.

Si un nombre no existe en el catálogo, esa línea **no** se descuenta y el
informe la marca como `NO ENCONTRADO`. Las otras 63 se aplican igual: nada
queda a medias sin que se vea.

### Guardas que abortan todo

Corre en una transacción. Si algo de esto no cierra, no se escribe nada:

- un código interno escrito en `ELECCIONES` que no existe;
- que no se resuelva ninguna línea (catálogo vacío);
- que la cantidad de movimientos escritos no sea igual a la de líneas
  resueltas, o que no descuenten exactamente las unidades de la lista;
- que el stock de algún SKU tocado deje de ser igual a la suma de todos sus
  movimientos — la invariante de la casa.

### Por qué impersona al dueño

`registrar_movimiento()` exige `usuario_activo()` y guarda `auth.uid()` en
el movimiento. Desde el SQL Editor no hay sesión, así que la transacción
arranca fijando el claim con `set_config('request.jwt.claims', ...)`, el
mismo patrón que usan los seeds del catálogo (ver
`supabase/seeds/21_laprida_vinos_tintos.sql`). Así los movimientos quedan
atribuidos a una persona real y no a nadie.

### Probado antes de entregar

Los dos scripts se corrieron contra un Postgres 16 descartable con un
catálogo armado con nombres reales de `supabase/seeds/`, y un stub de
`registrar_movimiento()` con la misma firma y la misma regla de signos que
la función real. Resultado: 64 movimientos, −166 unidades, y la invariante
stock = suma de movimientos cerrando en todas las filas.

## El stock en negativo

Un SKU que nunca se contó está en cero, así que el descuento lo deja en
negativo. No es un error del script: es la foto real de un sistema al que
todavía le falta catálogo por contar, y el movimiento es correcto — la
mercadería salió. Se corrige contando ese SKU, no borrando el movimiento.

Cuántos son depende de cuánto se haya contado hasta el momento de correrlo.
`00-estado-del-stock.sql` (solo lectura) lo dice, y el informe del paso 2 lo
marca línea por línea con `QUEDA EN NEGATIVO`.
