# BEBIDAS MOE — ARQUITECTURA DEL SISTEMA INTERNO

Documento de decisiones. Versión 1 — diseño funcional cerrado + modelo de datos propuesto.

---

# PARTE 1 — DECISIONES CERRADAS

## 1.1 Alcance y sucursales

- Dos sucursales: **Olavarría** y **Laprida**.
- Olavarría funciona como depósito central de facto: compra a proveedores y abastece a Laprida.
- Laprida **no compra a proveedores**. Solo pide a Olavarría.
- Flujo de pedidos **unidireccional**: Laprida pide → Olavarría abastece.
- Stock **siempre por sucursal**. Nunca existe un único `stock_total` editable.

## 1.2 Regla fundamental de stock

**Nadie modifica stock directamente.** Todo cambio proviene de un movimiento registrado:

| Tipo de movimiento | Origen |
|---|---|
| Entrada por compra | Recepción de compra confirmada |
| Salida por venta | POS |
| Salida por transferencia | Despacho a Laprida |
| Entrada por transferencia | Recepción en Laprida |
| Ajuste de inventario | Conteo físico |
| Merma / rotura | Registro manual |
| Devolución | Devolución de cliente (si reingresa) |

Cada movimiento guarda: producto/SKU, cantidad, sucursal, fecha, usuario, tipo, motivo, documento de referencia.

## 1.3 Productos y SKU

Jerarquía de tres niveles:

```
MARCA → PRODUCTO → SKU
Branca → Fernet Branca → Branca 750 / Branca 1L / Branca 450cc / Branca estuche
```

- El **SKU es la unidad real** del sistema. Stock, precio, costo y movimientos se atan al SKU.
- El producto existe solo para agrupar y facilitar la búsqueda.
- **Sabores y variedades son PRODUCTOS distintos**, no variantes: Branca Menta, Gordon's Pink, Bombay Bramble comparten marca pero no producto.
- **Packs y cajones son SKU planos con stock propio.** No se descomponen. "Unidades por pack" es dato informativo.
- **Combos armados por Moe** (ej. Branca + Coca) **no tienen stock propio**: descuentan sus componentes al venderse. Único caso de composición del sistema.

Criterio para distinguir: si el objeto existe físicamente como unidad en el depósito → SKU propio. Si se arma en el momento de la venta → combo.

### Desarme de packs (cascada)

Cada presentación tiene su propio código de barras y su propio precio. Toda la mercadería
llega en pack x24, y se desarma según se necesite:

```
pack x24  →  4 × pack x6  →  6 × unidad
```

- Cada SKU declara **en qué se desarma y con qué factor**.
- Movimiento nuevo: **`desarme`**, que genera un par salida/entrada atómico en la misma
  transacción (x24 −1 / x6 +4).
- Queda registrado con usuario y fecha, como cualquier otro movimiento.
- El inventario siempre cierra: 2 cajas cerradas + 21 latas sueltas es exactamente lo que
  dice el sistema.

**Atajo en el POS:** si se intenta vender una unidad y no hay stock de unidades pero sí de
packs, el sistema ofrece desarmar con un botón. La cascada se encadena sola (si no hay x6,
desarma un x24 primero).

**Como todo llega en x24**, cualquier stock de x6 o unidad tiene un desarme que lo explica.
Las compras a proveedor siempre cargan x24.

### Alternativas descartadas

- **Desarme automático sin confirmar:** rechazado. El stock se movería sin decisión humana
  y generaría diferencias silenciosas.
- **Stock en unidad base (todo en latas):** rechazado. El conteo físico se volvería
  impracticable (ver 4 cajas y 7 latas y tener que cargar 103), y se perdería la
  información de cuántos packs cerrados hay realmente.

## 1.4 Retornables

Dos circuitos paralelos que no se mezclan:

| Circuito mercadería | Circuito envase |
|---|---|
| Se compra y se vende | Entra del cliente, sale al proveedor |
| Descuenta stock normal | Stock propio, no vendible |
| Genera margen | Es un activo, no genera margen |

- Los envases se controlan **por TIPO DE ENVASE**, no por producto. Un tipo puede ser genérico (litro retornable compartido entre marcas) o específico de una marca. Cada SKU retornable apunta a un tipo.
- **Solo botellas.** Los cajones no se controlan como activo separado.
- Movimientos de envase: venta con envase (+1 vacío), venta sin envase (cobra depósito, sin cambio de vacíos), devolución de vacíos sueltos (+N, devuelve depósito), devolución al proveedor (−N).
- **El depósito de envase NO es facturación ni margen.** Se registra como categoría aparte.
- Devolución al proveedor: movimiento simple, sin flujo de estados.

## 1.5 Circuito Pedido → Transferencia (Laprida ← Olavarría)

**Dos objetos separados:** el pedido es la intención, la transferencia es el hecho físico.

```
PEDIDO
BORRADOR → ENVIADO → EN_PREPARACION → PREPARADO → DESPACHADO → CERRADO

TRANSFERENCIA (nace al despachar)
EN_TRANSITO → RECIBIDA
```

- Un pedido puede generar **N transferencias** (envíos parciales).
- **Movimiento de stock:** descuenta de Olavarría al despachar → estado intermedio "en tránsito" → acredita a Laprida al confirmar recepción. La mercadería en viaje no está en ninguna sucursal.
- **Faltantes:** si Olavarría no puede cubrir el pedido completo, el faltante queda abierto dentro del pedido original y **se suma automáticamente** a la sugerencia de la semana siguiente. El encargado siempre puede editar antes de confirmar.
- Se distinguen dos tipos de diferencia:
  - **Diferencia de preparación** (Olavarría no tenía stock) — se sabe antes de despachar.
  - **Diferencia de recepción** (llegó menos de lo despachado) — rotura, error de conteo.

### Sugerencia automática del pedido semanal

Etapa 1 (v1): `sugerido = stock objetivo − stock disponible efectivo + arrastre pendiente`
donde `stock disponible efectivo = stock actual + mercadería en tránsito + pedidos pendientes`

Etapas futuras: incorporar venta de últimas 4 semanas, días de cobertura, estacionalidad.

## 1.6 Compras y proveedores

**Dos pasos**, espejando el circuito interno:

```
COMPRA (documento comercial)     RECEPCIÓN (hecho físico)
BORRADOR → CONFIRMADA       →    PENDIENTE → RECIBIDA (total o parcial)
No mueve stock                    Genera movimiento de entrada
```

- Una compra puede tener **N recepciones** (mercadería en tandas).
- **Proveedor ↔ producto específico** (no solo marca/categoría). Habilita comparar proveedores y detectar productos sin proveedor activo.
- La compra es el **único lugar donde cambia el costo**. La ficha de producto lo muestra en solo lectura.

### Costo

- **Historial completo por lote/recepción**: cada entrada guarda costo, proveedor y fecha.
- El stock **no rastrea de qué lote sale** cada unidad.
- El "costo actual" mostrado = costo del último lote recibido.
- Migrable a FIFO más adelante sin perder datos, porque el historial ya se guarda desde el día uno.

## 1.7 Precios y promociones

```
Precio base (Olavarría)  → cada SKU con precio propio e independiente
  └── Laprida = Olavarría + (monto fijo de la categoría × unidades contenidas)
       └── override manual por SKU, marcado como excepción
```

Motivo de la diferencia: costo logístico de abastecer Laprida. **Es un monto fijo por
categoría, NO un porcentaje** — el cliente lo piensa como costo de transportar cada
botella, que es el mismo sea el producto caro o barato.

Ejemplo: vinos tintos +$500 (valor tentativo, sin confirmar).

**El recargo se multiplica por las unidades contenidas.** Un pack x6 con recargo de
categoría de $300 suma $1.800, no $300.

### Precios independientes por presentación (Olavarría)

En Olavarría los precios de unidad, x6 y x24 **no son proporcionales entre sí**. La lata
individual incluye recargo por frío (está en la heladera), por lo que su precio NO es el
del x6 dividido 6.

- Toda lata individual se vende fría: **precio único, no hay que modelar la temperatura**.
- El recargo por frío aplica solo a unidades, no a packs.

### Riesgo identificado: licuación del recargo

Los montos fijos no se revisan periódicamente (decisión del cliente). En contexto
inflacionario, un recargo fijo pierde valor real con el tiempo. **El sistema debe mostrar
la fecha de última actualización de cada recargo** para que sea evidente cuándo quedó viejo.

### Resolución de promociones — gana UNA sola, por prioridad

```
1. Combo
2. Promo por cantidad (2x, 3x)
3. Precio promocional vigente
4. Precio efectivo
5. Precio base
```

- Promos con **vigencia opcional**: sin fechas = permanente.
- **Advertencia automática** cuando el precio final queda por debajo del costo. Avisa, no bloquea, y queda registrado.
- Al enc. de Laprida (que no ve costos) la advertencia se muestra sin revelar el número.

## 1.8 Ventas y POS

**Construcción por etapas:**

- **Etapa 1 (v1):** POS operativo completo. Venta, stock, medios de pago, promociones, cierre de caja. Sin comprobante fiscal.
- **Etapa 2:** capa de facturación ARCA sobre el objeto Venta ya existente. No se reescribe nada.

**Desacople clave:** VENTA (hecho comercial) ≠ COMPROBANTE (hecho fiscal). Si ARCA está caído, la venta se registra igual y el comprobante queda en cola. El negocio no se para.

### Flujo del mostrador

```
Buscar/agregar productos → ticket con los dos totales posibles (si aplica)
→ Medio de pago AL FINAL, antes de cobrar → confirmar → descuenta stock + registra venta
```

- Medio de pago al final: mientras se escanean productos no se sabe qué medio va a usar el cliente, así que el ticket muestra los dos totales (efectivo / otro medio) cuando hay promociones o descuentos que solo aplican en efectivo. Si no hay ninguno, un solo total. El medio se elige recién antes de cobrar y es modificable hasta ese momento.
- **Búsqueda** por fragmentos (`jw dou` encuentra Johnnie Walker Double Black), más vendidos primero, grilla de accesos rápidos configurable. Compatible con lector de código de barras cuando lo compren.
- **Sin stock:** permite vender, advierte, y marca el producto para revisión de inventario.
- **Caja diaria por sucursal:** total, desglose por medio de pago, cantidad de tickets, diferencia entre sistema y efectivo real.

### Situación fiscal — ETAPA 2 EN CURSO (desde 2026-09-05)

**El cliente ya tiene un sistema que emite facturas A y B.** La integración con ARCA
arrancó como bloque de desarrollo el 2026-09-05 (ver `docs/bloque_arca_facturacion.md`
para el detalle completo). Mientras dure la convivencia de ambos sistemas puede haber
**doble carga** en las ventas que requieran factura: el stock lo lleva este sistema, la
factura la emite el otro, hasta que este bloque esté validado en homologación.

- Bebidas Moe es **Responsable Inscripto**.

### Decisiones cerradas para el bloque de facturación ARCA (2026-09-05)

- **Ambiente:** arranca en **homologación**, con el certificado personal de Francisco ya
  generado y vinculado al servicio WSFE. La migración al certificado de producción del
  cliente es un paso manual posterior, cuando el circuito esté validado.
- **Comprobantes soportados:** Factura A y Factura B únicamente (no C).
- **Disparo:** manual, con un botón **"Facturar"** separado de "Confirmar venta", en el
  detalle de la venta ya confirmada. Una venta puede quedar sin facturar indefinidamente
  sin romper nada — facturar nunca es requisito para cerrar una venta.
- **Alcance de sucursal:** **actualizado 2026-09-17** — cualquier sucursal con un punto
  de venta ARCA activo en `puntos_venta` puede facturar (mismo CUIT/certificado para
  todas, solo cambia el número de punto de venta). El botón "Facturar" aparece según
  `opera_sucursal()`, no según `es_central`. Laprida factura en cuanto tenga su fila en
  `puntos_venta` — el dueño la carga desde `/vender/facturar/configuracion` una vez
  confirmado/dado de alta el número en ARCA.
- **WSAA (autenticación) — firma 100% local, sin intermediarios.** La clave privada del
  certificado fiscal **nunca sale de la infraestructura propia** (Supabase/Vercel).
  Prohibido usar SDKs o servicios de terceros que reciban el certificado o la clave
  privada (ej. AfipSDK en modo cert/key), aunque digan no persistirla — se evaluó y se
  descartó explícitamente. El armado del TRA + firma CMS/PKCS#7 + login contra ARCA se
  implementa en el propio servidor. El Token+Sign resultante (válido 12hs) se cachea en
  una tabla propia; no se re-firma en cada venta.
- **WSFEv1 (facturación):** la solicitud de CAE (`FECAESolicitar`) se llama directo
  contra los servidores de ARCA (homologación `wswhomo.afip.gov.ar`, producción
  `servicios1.afip.gov.ar`), nunca a través de un proxy de terceros.
- **`CondicionIVAReceptorId`:** obligatorio desde el 1° de septiembre de 2026 (RG 5616).
  **No se hardcodea la tabla de valores** — se sincroniza llamando al método
  `FEParamGetCondicionIvaReceptor` de WSFEv1 contra una tabla propia `condicion_iva`,
  refrescada periódicamente (no en cada request).
- **Desglose de IVA (2026-09-07):** los precios cargados en el sistema son finales (IVA
  incluido) y hoy no hay alícuota por SKU. Se agrega `categorias.alicuota_iva` (numeric,
  default 21) — todo el catálogo de Bebidas Moe (vinos, whisky, gin, ron, vodka, licores,
  fernet, cerveza, gaseosas, energizantes, aceites/aceitunas gourmet, habanos, regalería)
  factura al 21%, la tasa general (las bebidas alcohólicas no acceden a ninguna alícuota
  reducida). No se hardcodea el 21% en el código: vive en la categoría para poder darle
  otro tratamiento a futuro sin tocar código. Al facturar, por línea de venta:
  `importe_neto = total_línea / (1 + alicuota_iva/100)`, `importe_iva = total_línea -
  importe_neto`, agrupado por alícuota (hoy siempre una sola, 21%).
- **Factura A sin CRM todavía:** el botón "Facturar" pide CUIT + razón social ahí mismo,
  en un formulario mínimo, en vez de bloquear el bloque hasta tener el CRM de clientes
  completo. Factura B usa Consumidor Final por default (con CUIT opcional).
- **El comprobante nunca modifica la venta:** es un registro nuevo (`comprobantes_fiscales`)
  que la referencia. Si falla la emisión, la venta sigue existiendo normalmente y se puede
  reintentar facturar — mismo principio de inmutabilidad que el resto del sistema.
- Certificado, clave privada y CUIT viven solo en variables de entorno del servidor: nunca
  en el repo, nunca en el cliente (browser), nunca en logs.

### Requisitos técnicos de ARCA relevados (para Etapa 2)

**Arquitectura de conexión:**
```
WSAA (autenticación)  → certificado digital → Token + Sign (válido 12 hs)
    ↓
WSFEv1 (facturación)  → datos de la venta → CAE + vencimiento
```

**Trámites previos (los hace el cliente con su clave fiscal):**
1. Generar llave privada (.key) y CSR
2. Subir CSR a ARCA → descargar certificado (.crt), vigencia 2 años
3. Asociar el certificado al servicio WSFE en el Administrador de Relaciones
4. Habilitar servicio de consulta de padrón (para validar CUIT en facturas A)
5. Dar de alta puntos de venta electrónicos
6. Repetir en ambiente de homologación con certificado propio

**Cambios normativos 2026 a contemplar:**
- `CondicionIVAReceptorId` es **obligatorio** en todo comprobante desde el 1° de
  septiembre de 2026 (RG 5616): sin ese campo el comprobante no se emite, incluso en
  Factura B a Consumidor Final.
- `CbteFchHsGen` (fecha y hora de generación) pasa a ser obligatorio.
- El **CAE en línea es la modalidad obligatoria** desde el 1° de agosto de 2026
  (RG 5782/5785). El **CAEA queda reservado solo como contingencia** ante caída real del
  servicio — no se admiten nuevas adhesiones a CAEA como modo principal. La
  implementación de contingencia CAEA queda fuera de alcance del bloque de facturación
  (se retoma más adelante si hace falta).
- El código QR en el comprobante es obligatorio.

**Impacto de la factura A en el modelo de datos:**
- Cada SKU necesita **`alicuota_iva`** declarada (no todo es 21%; confirmar con contador
  por categoría). La A exige IVA discriminado, lo que obliga a descomponer el precio final
  en neto + IVA.
- Necesaria una **ficha de cliente** (CUIT, razón social, condición IVA) para los comercios
  que facturan A y vuelven. Es además la semilla del CRM de clientes.
- Validación de CUIT contra el padrón de ARCA para evitar emitir A a quien no corresponde.

**Mantenimiento continuo:** cada resolución de ARCA puede cambiar campos obligatorios y
validaciones. Un sistema desactualizado genera rechazos o comprobantes inválidos. **Definir
con el cliente si el mantenimiento normativo está incluido en el proyecto o se cotiza aparte.**

**Pendiente de consultar con el contador:** cantidad de puntos de venta; si conviene CAEA
desde el inicio; si el rubro requiere Controlador Fiscal de Nueva Generación; alícuotas de
IVA por categoría; tratamiento fiscal del precio efectivo diferenciado.

**Recomendación de tiempos:** el trámite del certificado de homologación conviene iniciarlo
en paralelo al desarrollo, aunque falten meses para usarlo.

## 1.9 Inventarios físicos

- **Conteo fuera del horario comercial**, con registro de hora de inicio y fin.
- **Tres modalidades:** general (1-2 al año), por categoría (rotativo mensual), puntual (cuando algo no cierra).
- El encargado **ve el stock del sistema mientras cuenta**.
- El sistema muestra las diferencias, cada una requiere **motivo obligatorio** (rotura, robo, error de carga, error de conteo previo, vencimiento, desconocido).
- Al confirmar se generan movimientos de ajuste. El inventario queda **cerrado e inmutable**.
- Los productos marcados por "venta con stock en cero" alimentan la lista de conteo puntual sugerido.

## 1.10 Devoluciones de cliente

```
Buscar venta original → seleccionar productos
→ ¿reingresa al stock o va a merma?  (se decide en el momento)
→ ¿devolución de dinero o cambio por otro producto?
→ confirmar
```

- **Sin límite de tiempo** para devolver.
- Ambas modalidades aceptadas: dinero o cambio.
- En Etapa 2, la devolución de dinero requerirá nota de crédito fiscal.

## 1.11 Roles y permisos

Tres roles. Los dos encargados **no son simétricos**: Olavarría maneja abastecimiento de toda la empresa.

| | Dueño | Enc. Olavarría | Enc. Laprida |
|---|:---:|:---:|:---:|
| Stock propio | ✅ | ✅ | ✅ |
| Stock otra sucursal | ✅ | lectura | lectura |
| Precios de venta | edita | edita | lectura |
| Costos | ✅ | ✅ | ❌ |
| Proveedores | ✅ | ✅ | ❌ |
| Margen por producto | ✅ | ✅ | ❌ |
| Rentabilidad global | ✅ | ❌ | ❌ |
| Compras a proveedor | ✅ | ✅ | ❌ |
| Pedido semanal | ✅ | recibe | genera |
| Inventarios y ajustes | ✅ | libre | libre |
| Stock mínimo por producto | ✅ | ✅ | ❌ |
| Auditoría | ✅ | ❌ | ❌ |
| Usuarios | ✅ | ❌ | ❌ |

- Los permisos se cruzan en **dos ejes**: qué acción × en qué sucursal.
- El enc. de Olavarría **carga costos** en las compras (lo necesita para su tarea) pero no accede al análisis de rentabilidad global.
- **Ajustes de inventario sin aprobación previa.** El control es detectivo, vía auditoría.
- **Precios de venta sin aprobación previa en Olavarría.** Mismo criterio que los ajustes
  de inventario: la mercadería llega, el encargado la controla y define el precio en el
  momento — esperar al dueño termina en precios anotados en papel que el sistema no
  refleja. El control es detectivo: `precios`/`precios_sucursal` guardan quién cargó cada
  precio y cuándo (`actualizado_por`/`actualizado_en`, fijados por trigger con
  `auth.uid()`, no por la app), y el dashboard del dueño lista los precios cargados en los
  últimos 7 días con su margen. Laprida sigue en solo lectura.

## 1.12 Alertas

- **Panel dentro del sistema + resumen automático** (diario o semanal según rol).
- **Alertas de estado, no de bandeja:** se calculan al vuelo desde el estado real y desaparecen solas al resolverse. No se descartan a mano.
- Excepción: las alertas de **evento** (ej. "el costo de Tanqueray subió 18%") usan una ventana temporal de 30 días.
- **Preferencias de alerta configurables por usuario** (qué ver, con qué frecuencia).
- **El stock mínimo por producto NO es configurable por el encargado de Laprida**: lo define el dueño o el enc. de Olavarría, porque alimenta la lógica de reposición automática.

Alertas definidas:

| Alerta | Destinatario |
|---|---|
| Producto sin stock | Encargado de la sucursal |
| Stock bajo mínimo | Encargado de la sucursal |
| Transferencia en tránsito sin recibir | Encargado destino |
| Pedido de Laprida sin atender | Enc. Olavarría |
| Venta con stock en cero | Encargado + dueño |
| Costo aumentó | Enc. Olavarría + dueño |
| Margen bajo / precio bajo costo | Dueño |
| Producto sin movimiento (inmovilizado) | Dueño |
| Envases sin devolver hace mucho | Enc. Olavarría |

## 1.13 Dashboards

**Tres dashboards independientes**, no uno con elementos ocultos.

- **Dueño** — "¿cómo está Moe hoy?": stock valorizado (total y por sucursal), ventas del día/mes, margen, stock crítico, mercadería inmovilizada, compras del mes, transferencias pendientes, desglose de "dónde está la plata" por categoría.
- **Enc. Olavarría** — abastecimiento: pedidos de Laprida sin atender, stock bajo, productos a comprar, costos que subieron, envases a devolver.
- **Enc. Laprida** — reposición: qué falta, pedido semanal, mercadería en camino, alertas de su sucursal.

---

## 1.14 Infraestructura

**Hosting en la nube** (Supabase + Vercel), con hardware local en cada sucursal.

```
NUBE                          SUCURSAL
Supabase (base de datos)      PC con navegador
Vercel (aplicación)           Lector de código de barras (USB)
                              Impresora de tickets (opcional)
                              Conexión estable + 4G de respaldo
```

### Por qué nube y no instalación local

El cliente planteó inicialmente alojar el sistema en su computadora. Se descartó porque
**con instalaciones locales el sistema diseñado no se puede construir**:

- Dos sucursales = dos bases de datos separadas, sin dashboard consolidado del dueño.
- Las transferencias dejan de funcionar en tiempo real.
- El pedido semanal de Laprida necesita ver el stock de Olavarría.
- El dueño no podría consultar nada desde el celular.
- Backups, actualizaciones y soporte se duplican; un disco roto = datos perdidos.

Sincronizar dos bases que ambas escriben es uno de los problemas más difíciles del
desarrollo de software. No es "más trabajo": cambia la naturaleza del proyecto.

**El miedo de fondo (quedarse sin internet) se resuelve sin sacrificar la arquitectura:**
conexión 4G de respaldo, modo offline en el POS (guarda ventas localmente y sincroniza al
volver), y cola de comprobantes para Etapa 2.

Ambas sucursales tienen conexión estable, así que el modo offline es red de seguridad, no
requisito crítico. Igual conviene implementarlo: un corte un sábado a la noche es
exactamente cuando más se vende.

### Lector de código de barras

Un lector USB funciona **como un teclado**: no necesita drivers ni integración. Escanea,
"tipea" el código y da Enter.

```
Cursor en el campo de búsqueda → escaneás → el sistema busca el SKU,
lo agrega al ticket con su precio → cursor vuelve al campo
```

Como cada presentación tiene código propio, el x24 escaneado descuenta un x24 y la lata
suelta descuenta una lata, automáticamente.

**Requisito de carga inicial:** cada SKU necesita su código de barras cargado. Es trabajo
manual que se hace una sola vez, y puede hacerse progresivamente (los más vendidos primero).

---

# PARTE 2 — MODELO DE DATOS

Propuesta de estructura. Los nombres son orientativos y se ajustan al implementar.

## 2.1 Usuarios y organización

```
sucursales
  id, nombre, direccion, activo

usuarios
  id, nombre, email, rol, activo
  rol ∈ {dueño, encargado}

usuario_sucursal
  usuario_id, sucursal_id, permisos
  (un usuario puede operar una o más sucursales)
```

Nota: el rol "encargado" se diferencia por la sucursal asignada y sus permisos, no por dos roles distintos en la tabla. Esto evita duplicar lógica.

## 2.2 Catálogo

```
marcas
  id, nombre, activo

categorias
  id, nombre, categoria_padre_id (para subcategorías), activo

productos
  id, nombre, marca_id, categoria_id, activo
  (concepto comercial: "Fernet Branca")

tipos_envase
  id, nombre, es_generico, valor_deposito
  ("Litro retornable genérico", "Envase específico X")

skus
  id, producto_id, nombre, codigo_interno, codigo_barras
  volumen, unidad_volumen
  tipo_presentacion ∈ {unidad, pack, cajon, estuche}
  unidades_contenidas          ← cuántas unidades base contiene (para recargo Laprida)
  desarma_en_sku_id            ← NULL si no es desarmable
  desarma_en_cantidad          ← ej. x24 → 4 unidades de x6
  es_retornable, tipo_envase_id
  alicuota_iva                 ← para Etapa 2 (facturación A con IVA discriminado)
  costo_actual                 ← derivado del último lote recibido
  stock_minimo, stock_objetivo
  activo, imagen_url
```

El desarme se encadena siguiendo `desarma_en_sku_id` hasta llegar a un SKU no desarmable:
`x24 → x6 → unidad`.

## 2.3 Stock y movimientos — el núcleo

```
stock_sucursal
  sku_id, sucursal_id, cantidad
  UNIQUE(sku_id, sucursal_id)
  ← NUNCA se edita directamente. Solo por trigger/función desde movimientos.

movimientos_stock
  id, sku_id, sucursal_id
  tipo ∈ {compra, venta, transferencia_salida, transferencia_entrada,
          ajuste, merma, devolucion_entrada,
          desarme_salida, desarme_entrada}
  cantidad              (positiva o negativa según tipo)
  stock_anterior, stock_posterior
  usuario_id, fecha
  motivo
  documento_tipo, documento_id    ← referencia polimórfica al origen
```

**Regla técnica:** `stock_sucursal.cantidad` se actualiza únicamente mediante función de base de datos que inserta en `movimientos_stock` en la misma transacción. Nunca por UPDATE directo desde la aplicación.

```
stock_transito
  sku_id, transferencia_id, cantidad
  ← mercadería despachada de Olavarría y aún no recibida en Laprida
```

## 2.4 Envases retornables

```
stock_envases
  tipo_envase_id, sucursal_id, cantidad_vacios

movimientos_envases
  id, tipo_envase_id, sucursal_id
  tipo ∈ {ingreso_cliente, devolucion_proveedor, ajuste}
  cantidad, usuario_id, fecha, motivo, venta_id
```

## 2.5 Proveedores y compras

```
proveedores
  id, razon_social, nombre_comercial, cuit
  contacto, whatsapp, email, direccion
  condicion_pago, plazo_dias, observaciones, activo

proveedor_skus
  proveedor_id, sku_id, costo_referencia, activo

compras
  id, proveedor_id, sucursal_destino_id
  numero_factura, fecha_factura
  estado ∈ {borrador, confirmada, cerrada}
  usuario_id, total

compra_items
  id, compra_id, sku_id, cantidad, costo_unitario, subtotal

recepciones_compra
  id, compra_id, fecha, usuario_id
  estado ∈ {pendiente, recibida}

recepcion_items
  id, recepcion_id, compra_item_id, sku_id
  cantidad_recibida, diferencia, motivo_diferencia

historial_costos
  id, sku_id, proveedor_id, recepcion_id
  costo_unitario, cantidad, fecha
  ← una fila por lote recibido. Nunca se sobrescribe.
```

## 2.6 Pedidos y transferencias

```
pedidos
  id, numero (LP-XXXX)
  sucursal_origen_id, sucursal_destino_id
  estado ∈ {borrador, enviado, en_preparacion, preparado, despachado, cerrado}
  fecha_creacion, fecha_envio, fecha_cierre
  usuario_creador_id, usuario_preparador_id

pedido_items
  id, pedido_id, sku_id
  cantidad_solicitada
  cantidad_sugerida_sistema      ← para medir cuánto se corrige la sugerencia
  cantidad_preparada
  cantidad_pendiente             ← alimenta el arrastre de la semana siguiente
  observacion_encargado          ← "fin de semana largo", "promoción"

transferencias
  id, pedido_id, sucursal_origen_id, sucursal_destino_id
  estado ∈ {en_transito, recibida}
  fecha_despacho, fecha_recepcion
  usuario_despacho_id, usuario_recepcion_id
  observaciones

transferencia_items
  id, transferencia_id, sku_id
  cantidad_despachada, cantidad_recibida
  diferencia, motivo_diferencia
```

## 2.7 Precios y promociones

```
precios
  id, sku_id, precio_base
  vigente_desde, vigente_hasta

precios_sucursal
  sku_id, sucursal_id
  precio_override            ← NULL = usa la regla de recargo
  es_excepcion

recargos_sucursal
  sucursal_id, categoria_id
  monto_fijo                 ← por unidad contenida
  actualizado_en             ← para detectar recargos que quedaron viejos

Precio final Laprida = precio_base_Olavarría
                     + (monto_fijo de la categoría × sku.unidades_contenidas)

promociones
  id, nombre, tipo ∈ {combo, cantidad, promocional, efectivo}
  prioridad
  vigente_desde, vigente_hasta   ← NULL = permanente
  sucursal_id                    ← NULL = todas
  activo

promocion_items
  id, promocion_id, sku_id
  cantidad_requerida, precio_promocional
```

## 2.8 Ventas

```
ventas
  id, sucursal_id, usuario_id, fecha
  medio_pago
  subtotal, descuentos, total
  deposito_envases              ← NO cuenta como facturación
  caja_id
  estado ∈ {confirmada, anulada}

venta_items
  id, venta_id, sku_id
  cantidad, precio_unitario, promocion_aplicada_id
  con_envase                    ← para retornables
  vendido_sin_stock             ← marca para revisión de inventario

cajas
  id, sucursal_id, fecha
  total_sistema, total_declarado, diferencia
  usuario_cierre_id, estado

devoluciones
  id, venta_id, sucursal_id, usuario_id, fecha
  modalidad ∈ {dinero, cambio}
  venta_cambio_id               ← si es cambio

devolucion_items
  id, devolucion_id, sku_id, cantidad
  destino ∈ {reingreso, merma}
  motivo
```

**Etapa 2 (ARCA) — modelo real del bloque, ver `docs/bloque_arca_facturacion.md`:**

```
condicion_iva
  id, codigo_arca, nombre        -- sincronizado desde FEParamGetCondicionIvaReceptor,
                                  -- nunca hardcodeado, refrescado periódicamente

puntos_venta
  id, sucursal_id (uno por sucursal que facture), numero_arca, activo

arca_ta_cache
  servicio ('wsfe'), token, sign, expira_en
  -- Token+Sign de WSAA (vigencia 12hs), cacheado para no re-firmar en cada venta

comprobantes_fiscales
  id, venta_id (FK, único -- una venta = máximo un comprobante válido)
  tipo_cbte ('A', 'B')
  punto_venta_id, numero_comprobante
  cae, vencimiento_cae
  condicion_iva_receptor_id (FK a condicion_iva)
  cuit_receptor, razon_social_receptor (ambos nullable -- solo Factura A los exige)
  importe_total, importe_neto, importe_iva
  estado ∈ {pendiente, autorizado, rechazado, error}
  motivo_rechazo, qr_data
  creado_por, creado_en

comprobantes_fiscales_items
  comprobante_id, venta_item_id, descripcion, cantidad, precio_unitario, subtotal
```

El comprobante nunca modifica la venta: es un registro nuevo que la referencia. La firma
WSAA (TRA + CMS/PKCS#7) y la llamada a `FECAESolicitar` ocurren en el servidor de la app
(Node.js), no dentro de Postgres — la función `SECURITY DEFINER` solo persiste el
resultado ya obtenido, con el mismo mecanismo de bloqueo de escritura directa que usan
`ventas`/`cajas`.

## 2.9 Inventarios

```
inventarios
  id, sucursal_id, tipo ∈ {general, categoria, puntual}
  categoria_id                  ← si aplica
  estado ∈ {abierto, cerrado}
  fecha_inicio, fecha_fin
  usuario_id

inventario_items
  id, inventario_id, sku_id
  stock_sistema                 ← foto al iniciar
  stock_contado
  diferencia
  motivo                        ← obligatorio si hay diferencia
  movimiento_ajuste_id
```

## 2.10 Auditoría

```
auditoria
  id, usuario_id, fecha
  entidad, entidad_id
  accion ∈ {crear, modificar, eliminar, confirmar, anular}
  valor_anterior (jsonb), valor_nuevo (jsonb)
  ip, dispositivo
```

Se registran especialmente: cambios de precio, ajustes de inventario, anulación de ventas, cambios de costo, modificaciones de permisos.

---

# PARTE 3 — PENDIENTES

## 3.1 Decisiones que requieren información externa

- **Montos de recargo de Laprida por categoría** (el ejemplo mencionado fue +$500 en vinos
  tintos, sin confirmar).
- **Precios actualizados** de ambas sucursales.
- **Tipos de envase concretos** que maneja Moe y cuáles son genéricos.
- Si el recargo de Laprida en **cajones** también se calcula por unidad contenida.
- **Alícuotas de IVA por categoría** (para Etapa 2, con el contador).
- **Número de punto de venta ARCA** ya dado de alta para el servicio WSFE (lo carga
  Francisco cuando el bloque de facturación lo necesite).

## 3.2 Relevamiento operativo pendiente

- Proveedores reales y sus condiciones.
- Cantidad de empleados y responsabilidades.
- Cómo se registra hoy cada venta.
- Frecuencia real de reposición a Laprida.
- Stock actual y costos actuales.
- Cómo se hacen hoy los inventarios.

## 3.3 Hardware

- **Lector de código de barras USB** para cada mostrador. Confirmado como requisito por el
  cliente. Sin drivers ni integración: funciona como teclado.
- **Impresora de tickets** (a confirmar si la quieren).
- **Conexión 4G de respaldo** (recomendada, no imprescindible).

## 3.4 Mejoras identificadas, postergadas conscientemente

- Costeo FIFO real (el historial por lote ya queda guardado, así que es migrable).
- Advertencia al devolver productos de ventas muy antiguas (riesgo inflacionario).
- Conteo a ciegas en inventarios generales.
- Alerta al dueño por ajustes de inventario de monto elevado.
- Caja por turno o por empleado (hoy es diaria y compartida).
- Sugerencia de pedido con rotación histórica, estacionalidad y días de cobertura.
### Promociones: casos complejos postergados

El motor de promociones cubre dos tipos, que representan el 95% de las
promos reales del cliente:

- **Combo fijo**: dos SKU específicos a precio conjunto
  (ej. Branca 750 + Coca 2.25 = $21.400)
- **2x del mismo SKU**: precio fijo por dos unidades
  (ej. Heraclito 2x$20.000)

Todas las promociones son **solo en efectivo** (billete en mano).

Quedan pendientes tres casos que no encajan en esos dos tipos:

**1. Combo con opciones a elección.**
The Mula 3 botellas $16.800: "1 Doble IPA + 1 IPA o APA + 1 clásica a
elección". El cliente elige entre varios SKU dentro de cada posición del
combo. Requiere modelar grupos de opciones, no una lista fija de SKU.

**2. 2x que exige SKU distintos.**
Jack Daniel's litro 2x$93.000, "tienen que ser dos botellas diferentes".
Es un 2x que valida que los dos productos NO sean el mismo SKU, dentro de
un conjunto acotado (Apple, Fire, etc.).

**3. Descuento por efectivo fuera de vinos.**
Whisky en botellas de 3 litros: "abonando en efectivo 10% de descuento".
El modelo actual tiene el descuento por efectivo solo para vinos en
Olavarría. Este caso requiere que el descuento se pueda definir por SKU
además de por categoría.

Mientras tanto, estos casos se cargan a mano en el ticket ajustando el
precio de las líneas.

**Pantalla de administración de promociones — implementada.** Pestaña
separada dentro de `/precios` (`PreciosTabs` + `PromocionesPanel` +
`PromocionForm`, migración `20260903090000_bloque_promociones_admin.sql`),
como estaba decidido: no mezclada en la misma tabla que precios/recargos
para no volver confusa esa pantalla. Ya no hace falta insertar promos por
SQL directo.

---

# PARTE 4 — ORDEN DE CONSTRUCCIÓN SUGERIDO

```
1. Base           usuarios, sucursales, permisos, RLS
2. Catálogo       marcas, categorías, productos, SKU, tipos de envase
3. Núcleo stock   stock_sucursal + movimientos_stock + funciones de BD
                  ← todo lo demás se apoya acá
4. Compras        proveedores, compras, recepciones, historial de costos
5. Precios        precios, ajuste por sucursal, promociones
6. POS            ventas, caja, devoluciones
7. Pedidos        pedido semanal, transferencias, tránsito, recepción
8. Inventarios    conteo, diferencias, ajustes
9. Retornables    envases, depósitos, devolución a proveedor
10. Reportes      dashboards por rol, alertas
11. Etapa 2       facturación ARCA  ← EN CURSO desde 2026-09-05
```

El bloque 3 es el corazón del sistema. Si la función de movimientos está bien construida, todo lo demás se apoya en algo sólido. Si está mal, cada módulo posterior arrastra el problema.
