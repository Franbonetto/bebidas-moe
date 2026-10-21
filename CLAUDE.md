# Bebidas Moe — Sistema interno

ERP/CRM interno para un comercio de bebidas con dos sucursales en Argentina.
Stack: Next.js + Supabase (Postgres) + Tailwind. Español rioplatense en toda la interfaz.

---

## REGLAS INVIOLABLES

Estas reglas no se negocian. Si una tarea parece requerir romper alguna, **detenete y
preguntá** en vez de improvisar una solución.

### 1. El stock nunca se modifica directamente

`stock_sucursal.cantidad` **jamás** se actualiza con un UPDATE desde la aplicación.
Todo cambio de stock ocurre exclusivamente mediante una función de base de datos que:

1. Inserta el registro en `movimientos_stock`
2. Actualiza `stock_sucursal`
3. Ambas cosas en la **misma transacción**

Si no hay movimiento, no hay cambio de stock. Sin excepciones.

Cada movimiento guarda: sku_id, sucursal_id, tipo, cantidad, stock_anterior,
stock_posterior, usuario_id, fecha, motivo, documento_tipo, documento_id.

### 2. Nunca borrar movimientos históricos

Para "corregir" stock se genera un movimiento de ajuste, nunca se borra ni edita un
movimiento anterior. Los movimientos son inmutables.

### 3. Todo está asociado a una sucursal

Stock, movimientos, ventas, compras, transferencias, inventarios y permisos siempre
llevan `sucursal_id`. No existe un stock global editable — el total es una suma calculada.

### 4. Los productos son SKU, no nombres

Jerarquía: `Marca → Producto → SKU`. Todo (stock, precio, costo, movimientos) se ata al
SKU. El producto solo agrupa para búsqueda.

### 5. Trazabilidad antes que velocidad de desarrollo

Usar transacciones, constraints, validaciones y RLS. Ante la duda entre una solución
rápida y una trazable, elegir la trazable. No implementar nada que pueda generar
inconsistencias de inventario.

### 6. Nunca inventar lógica de negocio

Si algo no está definido en `docs/arquitectura.md`, **preguntá**. No asumas, no improvises,
no completes con lo que "suele hacerse". Las decisiones de negocio ya fueron tomadas y
están documentadas.
## Regla: integración ARCA (WSAA/WSFEv1)

- La clave privada del certificado fiscal (cert/key del cliente) NUNCA sale de
  nuestra infraestructura. Prohibido usar SDKs o servicios de terceros que
  requieran subir la clave privada o el certificado a un backend externo
  (ej. AfipSDK en modo cert/key), aunque digan no persistirla.
- La autenticación WSAA (armado del TRA + firma CMS/PKCS#7 + login contra
  ARCA) se implementa localmente, en nuestro propio servidor, usando
  `node-forge` (u openssl si se justifica). El Token+Sign resultante se
  cachea (válido 12hs) en una tabla propia; no se re-firma en cada venta.
- La solicitud de CAE (WSFEv1 / FECAESolicitar) se llama directo contra los
  servidores de ARCA (homologación: wswhomo.afip.gov.ar / producción:
  servicios1.afip.gov.ar), nunca a través de un proxy de terceros.
- Cert, key y CUIT del cliente viven solo en variables de entorno del
  servidor. Nunca en el repo, nunca en el cliente (browser), nunca en logs.
---

## CONTEXTO DEL NEGOCIO

**Olavarría** — sucursal + depósito central. Compra a proveedores y abastece a Laprida.
**Laprida** — sucursal satélite. No compra a proveedores, solo pide a Olavarría.

Flujo de pedidos **unidireccional**: Laprida pide, Olavarría despacha.

### Roles (tres, no más)

| | Dueño | Enc. Olavarría | Enc. Laprida |
|---|---|---|---|
| Costos y proveedores | sí | sí | **no** |
| Margen por producto | sí | sí | **no** |
| Rentabilidad global | sí | **no** | **no** |
| Compras a proveedor | sí | sí | **no** |
| Cargar precios de venta | sí | sí | **no** (solo lectura) |
| Auditoría y usuarios | sí | **no** | **no** |

Los encargados **no son simétricos**: Olavarría maneja el abastecimiento de toda la
empresa, por eso ve costos. Laprida no.

**Precios de venta: control detectivo, no preventivo.** El encargado de Olavarría carga
precios sin aprobación previa del dueño (mismo criterio que los ajustes de inventario) —
la mercadería llega, se controla y se define el precio en el momento. La trazabilidad
(quién cargó cada precio y cuándo) reemplaza la aprobación previa.

---

## REGLAS DE NEGOCIO CLAVE

### Desarme de packs
Todo llega en pack x24. Se desarma en cascada: `x24 → 4 × x6 → 6 × unidad`.
Cada presentación es un SKU independiente con su propio código de barras, precio y stock.
El desarme genera un par de movimientos atómicos (salida del pack, entrada del contenido).

**Los packs NO se descomponen automáticamente al vender.** Un pack x6 vendido descuenta
un pack x6, no seis unidades.

### Combos
Único caso de composición: un combo armado por Moe (ej. Branca + Coca) **no tiene stock
propio** y descuenta sus componentes. Distinto de un pack, que sí tiene stock propio.

### Precios
```
Precio base = Olavarría (cada SKU con precio propio, NO proporcional entre presentaciones)
Laprida = Olavarría + (monto fijo de la categoría × unidades contenidas)
Override manual por SKU posible, marcado como excepción
```

La lata individual incluye recargo por frío. Su precio NO es el del x6 dividido 6.

### Promociones — gana UNA sola, por prioridad
```
1. Combo  →  2. Cantidad (2x)  →  3. Promocional  →  4. Efectivo  →  5. Base
```
El precio que se carga es el **total de la promo**, y va **por sucursal** (Olavarría y
Laprida no manejan los mismos precios). En un combo, el reparto entre sus productos lo
calcula el sistema y no se muestra en ninguna pantalla: el ticket dice el nombre de la
promoción y su total.

Vigencia opcional (sin fechas = permanente, y el formulario lo dice así: "Activa sin
fecha límite").
**Advertir siempre** si el precio final queda bajo el costo (avisar, no bloquear).
Al encargado de Laprida se le advierte sin mostrarle el número del costo.

### Efectivo = billete en mano
Débito, crédito y transferencia **no** cuentan como efectivo.
Las promociones aplican solo pagando en efectivo.

### POS
- Medio de pago **al final**, antes de cobrar.
- **Un cobro, una venta (2026-10-20).** El POS genera una clave por cobro y la
  repite si tiene que reintentar; `confirmar_venta()` tiene un unique index sobre
  esa clave y, si ya tiene venta, **devuelve esa misma venta** en lugar de grabar
  otra (`supabase/migrations/20261020130000_venta_idempotente.sql`). Es lo que
  impide que un Enter de más, o un corte de red mientras se espera el CAE, cobren
  dos veces la misma venta y descuadren la caja. Una acción nueva que grabe una
  venta lleva su clave; no alcanza con deshabilitar el botón.
- **Un solo total a la vista** (cambiado el 2026-10-08: antes se mostraban los dos
  y confundía). Mientras no se eligió medio de pago se muestra el de efectivo, que
  es como se cobra la mayoría de las ventas, con una línea al pie aclarando cuánto
  sería con otro medio. Al elegir un medio que no es efectivo, el número grande pasa
  a ser el de ese medio y se avisa que perdió el descuento.
- Sin stock: **permitir vender**, advertir, y marcar el SKU para revisión de inventario.
- Caja diaria por sucursal.
- **Envíos (`/envios`)** son el mismo POS en modo envío, con tres datos
  obligatorios que la cajera completa a mano: motomandado, dirección y
  **"¿el pedido ya está pago?"** (2026-10-19). Ese último flag **no toca la
  caja**: la venta se contabiliza igual que cualquier otra, así que el
  arqueo del día espera esa plata aunque el motomandado todavía no haya
  vuelto con ella. Es un dato del envío (sale en el ticket y en el
  historial), no un estado de cobranza: nadie lo actualiza después. Ver
  `supabase/migrations/20261019090000_envio_pagado.sql`.
- **Se factura solo lo que no es efectivo (2026-10-19).** Débito, crédito,
  transferencia y QR dejan rastro bancario, así que esas ventas se facturan
  automáticamente al cobrar: Factura B a Consumidor Final, emitida por
  `confirmarVenta()` después de que `confirmar_venta()` ya grabó la venta. El POS
  espera el CAE (tope de 15s) para que el ticket salga ya con CAE y QR y el cliente
  se lleve la factura en el mismo papel. En un pago dividido alcanza con que **uno**
  de los medios no sea efectivo para facturar la venta entera.
  - **Nunca voltea la venta.** Si ARCA rechaza, tarda o está caído, la venta queda
    igual y el comprobante en `rechazado`/`error`: el POS avisa el motivo y se
    emite a mano desde `/vender/facturar`. Lo mismo si ARCA rechaza por el tope de
    monto sin identificar al comprador: ahí se emite a mano con DNI/CUIT.
  - **La venta en efectivo sigue sin facturarse sola.** El ticket es el interno
    (fecha, hora, productos, total, dirección de la sucursal) con la leyenda
    "Documento no válido como factura". Si el cliente pide factura, se emite a mano
    desde `/vender/facturar`.
- **Producto particular:** una línea sin SKU, con descripción y precio escritos a
  mano (picada, canasta de regalería). No descuenta stock —no hay nada que
  descontar—, no entra en promociones y va al 21% si se factura.
- **Precio tocado a mano (2026-10-17):** cada línea del ticket tiene un lápiz
  (reemplaza el precio de ese producto en esa venta) y un recargo por frío (suma
  un monto por unidad). Solo dueño y Olavarría (`ve_costos()`). El lápiz arregla
  la venta, **no el catálogo**. Ninguno de los dos aplica sobre una línea con
  promoción ni sobre un producto particular. Ver `docs/arquitectura.md` 1.8,
  *Precio tocado a mano en el mostrador*.

### Costo
Historial completo por lote/recepción. El stock **no** rastrea de qué lote sale cada
unidad. `costo_actual` = costo del último lote recibido. Preparado para migrar a FIFO
sin perder datos.

**El costo del producto es lo que se pagó, con impuestos adentro.** La Factura A lista
el detalle sin IVA, así que la encargada carga el número del papel y el sistema reparte
los impuestos del pie entre las líneas: `factor = total pagado / total de las líneas`.
`costo_unitario` queda como lo que decía la factura y `costo_con_impuestos` al lado;
`skus.costo_actual` = `coalesce(costo_con_impuestos, costo_unitario)`. Con remito o
Factura B no hay pie: manda el costo unitario pelado. Ver `docs/arquitectura.md` 1.6,
*Costo con impuestos* (2026-10-16).

**El flete entra al costo igual que los impuestos (2026-10-21).** Campo opcional del
encabezado de la entrada, para el flete que se paga **aparte** (si viene como línea de
la factura ya está en el neto y cargarlo lo duplicaría): el factor pasa a ser
`(total pagado + flete) / total de las líneas`. Con remito y flete también se reparte.
No es fiscal: no toca IVA ni el balance, y queda afuera del cuadre del pie. Se corrige
con `reclasificar_comprobante_compra()`, con motivo y log. Ver `docs/arquitectura.md`
1.6, *Flete*.

### Pedidos y transferencias
```
PEDIDO:        borrador → enviado → en_preparacion → preparado → despachado → cerrado
TRANSFERENCIA: en_transito → recibida     (nace al despachar)
```
- Un pedido puede generar N transferencias (envíos parciales).
- Stock: descuenta de Olavarría **al despachar** → estado "en tránsito" → acredita a
  Laprida **al recibir**.
- Faltantes quedan abiertos en el pedido y se suman automáticamente a la sugerencia de
  la semana siguiente.

### Retornables
Stock de envases vacíos **por tipo de envase** (no por producto). Un tipo puede ser
genérico (litro compartido entre marcas) o específico. Solo botellas, no cajones.
El depósito de envase **no es facturación ni margen**: categoría aparte.

### Inventarios
Conteo fuera del horario comercial. Tres modalidades: general, por categoría, puntual.
El encargado ve el stock del sistema mientras cuenta.
Diferencias requieren **motivo obligatorio**. Al confirmar se generan ajustes y el
inventario queda cerrado e inmutable.

---

## ETAPA 2: FACTURACIÓN ARCA — EN PRODUCCIÓN DESDE 2026-10-20

**Ya no está fuera de alcance.** A partir de 2026-09-05 se decidió arrancar la
integración con ARCA (ex AFIP) descripta en `docs/bloque_arca_facturacion.md` —
leer ese documento completo antes de tocar este bloque. Resumen de las decisiones
ya cerradas ahí (no volver a preguntarlas):

- **El sistema factura de verdad desde el 2026-10-20.** Toda factura que emite
  tiene validez fiscal: un comprobante no se borra ni se edita, se anula con nota
  de crédito (que todavía no existe — está en los pendientes del bloque). El
  cruce de homologación a producción está documentado en
  `scripts/paso-arca-produccion-2026-10-20/README.md`.
- El ambiente vive en `ARCA_ENTORNO` (`homologacion` | `produccion`), nunca
  hardcodeado, y el cache del Ticket de Acceso está indexado por
  `(entorno, servicio)`: el token de un ambiente no se usa contra el otro. Si
  volvés a homologación a probar algo, **acordate de volver a producción** — la
  pantalla `/vender/facturar/configuracion` dice en qué ambiente está.
- Factura A y B únicamente (no C). Disparo manual desde un botón "Facturar" en el
  detalle de la venta — nunca bloquea el cierre de la venta en sí. **Desde
  2026-10-19 se suma el disparo automático** para las ventas que no son en
  efectivo (ver la sección POS): el botón manual sigue existiendo para la Factura
  A, para el efectivo y para reintentar lo que ARCA no autorizó.
- Solo Olavarría factura por ahora (un único punto de venta ARCA).
- `venta` queda desacoplada de `comprobante`: el comprobante es un registro aparte
  que referencia a la venta, nunca la modifica.
- `CondicionIVAReceptorId` obligatorio en todo comprobante (RG 5616), CAE en línea
  obligatorio (RG 5782/5785) — CAEA fuera de alcance de este bloque.

## FUERA DE ALCANCE (por ahora)

- CRM de clientes (etapa posterior), **salvo la libreta de clientes** que se
  adelantó el 2026-10-20 a pedido del usuario: una tabla `clientes` con CUIT,
  razón social y condición de IVA, que la vendedora busca por nombre o CUIT al
  facturar y que se llena sola con cada comprobante a receptor identificado
  (`supabase/migrations/20261020120000_clientes.sql`). Es solo lo necesario
  para emitir: **no** hay historial de compras por cliente, ni cuenta
  corriente, ni datos de contacto, ni pantalla de administración — todo eso
  sigue siendo etapa posterior.
- Costeo FIFO (el historial por lote ya se guarda, para migrar después).

---

## INTERFAZ

Ver `docs/identidad-visual.md`. En resumen:

- Fondo **blanco** dominante, gris muy claro `#F7F7F8` como secundario.
- Rojo Moe `#C8201A` **solo como acento**: botón primario, item activo, links, foco.
  Nunca como fondo de áreas grandes. Nunca sidebar roja ni negra.
- Tipografía Inter. Números con `tabular-nums`.
- Estados con colores universales suaves: verde OK, amarillo atención, naranja
  importante, rojo error, azul información/tránsito. Fondo claro + texto de color.
- Tablas densas y escaneables. Bordes suaves, sin sombras, radio 8px.
- **Densidad de información equilibrada.** No convertir cada dato en una card gigante.
- Estados vacíos con mensaje útil, nunca "No data".
- Español natural, no jerga técnica: "Quedan pocas unidades", no "SKU threshold reached".
- Mobile-friendly: las tablas complejas se adaptan, no se comprimen.

**Principio:** simple para operar, claro para controlar, rápido para decidir.
Antes de agregar un elemento visual: ¿ayuda a entender información o realizar una acción?
Si no, no va.

---

## CÓMO TRABAJAR

- Un bloque por vez, siguiendo el orden de `docs/arquitectura.md` (Parte 4).
- Antes de escribir código, explicá qué vas a hacer y esperá confirmación.
- Si una decisión de negocio no está documentada, **preguntá**.
- Migraciones SQL versionadas en `supabase/migrations/`.
- No instalar dependencias sin avisar.
Nunca apliques migraciones contra Supabase. Pasame el SQL y lo corro yo
desde el SQL Editor. Es mi único punto de control sobre lo que le pasa
a la base.
---

## NOTAS DEL ENTORNO

**Turbopack no funciona en esta máquina.** Falla al lanzar el proceso de
PostCSS (exit code 0xc0000142 en Windows). El script `dev` de package.json
usa `next dev --webpack`. No lo cambies a Turbopack.

Desde 2026-10-04, una política de Application Control de Windows además
bloquea el binario nativo `@next/swc-win32-x64-msvc`: Next cae a WASM y,
al no tener bindings nativos, `next build` intenta Turbopack y aborta. Para
compilar localmente hay que correr `npx next build --webpack` (con eso
compila, solo imprime el warning del binario bloqueado). El script `build`
de package.json se deja como está: Vercel compila en Linux, donde el
binario nativo carga bien.

**El día del negocio es el día de Argentina, nunca el del servidor.**
Vercel y Supabase corren en UTC, así que `current_date` y `new Date()`
cambian de día a las 21:00 de acá y el local cierra a las 22. Eso rompía la
caja (no se podía vender entre las 21 y las 00), el "vendido hoy", la
vigencia de las promos y el `CbteFch` de las facturas. Desde 2026-10-19:

- en la base, `fecha_operativa()` en lugar de `current_date` para todo lo
  que define el día del negocio (ver
  `20261019100000_fecha_operativa.sql`);
- en la app, `fechaOperativa()` / `inicioDelDia()` / `inicioDelMes()` /
  `inicioDeSemana()` de `lib/fecha.ts`, nunca `new Date().toISOString()` ni
  `setHours(0,0,0,0)`.

Argentina no tiene horario de verano: es UTC-3 todo el año, y eso está
asumido en los dos lados.

**PIN de operaciones (`PIN_OPERACIONES`).** Entrada de mercadería, ajuste
de stock desde productos, precios, promociones y carga inicial piden un PIN
antes de confirmar (pedido del usuario 2026-10-19). No es un permiso —los
permisos siguen siendo los roles y la RLS—, es un freno para que nadie
cambie un precio o el stock de paso con la sesión de la encargada abierta
en el mostrador.

- El PIN vive en la variable de entorno `PIN_OPERACIONES` (Vercel y
  `.env.local`), nunca en el repo. **Si falta, esas pantallas no dejan
  confirmar**: falla cerrada a propósito.
- Se valida **siempre en el servidor**, en cada acción (`lib/pin.ts`). El
  desbloqueo es por pantalla (`PinProvider` + `usePinOperaciones()`, ver
  `app/(app)/_components/pin-gate.tsx`): se pide una vez y el PIN viaja en
  cada acción de esa pantalla.
- Una acción nueva en esas pantallas lleva `pin: string` como último
  parámetro y empieza con `verificarPinOperaciones(pin)`.

**Ajustar stock de un SKU suelto** (`/productos` → editar) va por
`ajustar_stock_contado()`: se escribe el stock **real contado**, no la
diferencia, y la función calcula el delta con la fila bloqueada y genera el
movimiento de ajuste. El motivo es obligatorio. No reemplaza a Inventarios,
que sigue siendo el conteo en serio con cierre inmutable.

**Toda tabla nueva necesita permisos explícitos.** El proyecto de Supabase
se creó con "Automatically expose new tables" desactivado, así que las
tablas nuevas no reciben ningún privilegio para el rol `authenticated` y
devuelven 403 aunque las políticas RLS estén bien.

Después de cada migración que cree tablas, correr:

    grant select on all tables in schema public to authenticated;

para SELECT en todas las tablas (RLS decide qué filas ve cada usuario), y
además, tabla por tabla, el grant de `insert`/`update`/`delete` que
corresponda **solo si la tabla se escribe directo desde la app**:

    grant insert, update, delete on <tabla> to authenticated;

El criterio es cómo escribe cada tabla, no si es "de negocio" o no:

- **La app escribe la tabla directo** (vía políticas RLS de insert/update/
  delete, ej. `proveedores`, `compras`, `compra_items`): necesita el grant
  de esa operación. Sin él, la política de RLS nunca llega a evaluarse — el
  grant es un prerrequisito de Postgres, no un reemplazo de RLS.
- **Solo una función `SECURITY DEFINER` la escribe** (ej. `stock_sucursal`,
  `movimientos_stock`, `historial_costos`, o `recepciones_compra` para su
  UPDATE de estado): NO lleva grant de esa operación. La función corre como
  dueña de la tabla y no lo necesita; dar el grant igual solo agrega
  superficie sin habilitar nada (RLS la sigue bloqueando si no hay política),
  así que no vale la pena.

Antes de dar un bloque por cerrado, repasar cada tabla nueva contra sus
propias políticas de RLS: si tiene política de insert/update/delete para
`authenticated`, tiene que tener el grant correspondiente. Esto NO
debilita la seguridad: RLS sigue decidiendo qué filas puede tocar cada
usuario. El grant solo habilita el acceso base a la tabla.