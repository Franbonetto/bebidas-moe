# Bloque: Integración ARCA — Facturación fiscal desde el POS

Pegar este documento como contexto al arrancar la sesión de Claude Code para
este bloque. Leer primero `CLAUDE.md` y `docs/arquitectura.md` como siempre.

---

## 1. Objetivo del bloque

Permitir que, desde el POS, una venta ya confirmada pueda facturarse
fiscalmente contra ARCA (ex AFIP), obteniendo CAE y quedando en condiciones
legales de entregarse al cliente. Arrancamos en **ambiente de homologación**
con el certificado personal de Francisco; la migración al certificado de
producción del cliente es un paso posterior (ya se tiene la clave fiscal del
dueño para generarlo cuando corresponda).

---

## 2. Decisiones de negocio ya cerradas

- **Ambiente:** homologación primero. No tocar producción hasta validar el
  circuito completo con comprobantes de prueba.
- **Comprobantes soportados:** Factura A y Factura B (no C por ahora).
- **Disparo:** manual. La venta se confirma normalmente en el POS
  (`confirmar_venta()`, sin cambios); la facturación es un paso aparte,
  con un botón **"Facturar"** en el detalle de la venta. Una venta puede
  quedar sin facturar indefinidamente sin romper nada — no es un requisito
  para cerrar la venta.
- **Librería:** usar un wrapper de WSAA/WSFEv1 tipo `afip.js` /
  `@afipsdk/afip.js` en vez de armar el SOAP a mano. Evaluar cuál está
  mejor mantenida al momento de implementar.
- **Alcance de sucursal:** **actualizado 2026-09-17** — ya no es exclusivo
  de Olavarría. Cualquier sucursal con un punto de venta ARCA activo
  configurado en `puntos_venta` puede facturar sus propias ventas (mismo
  CUIT/certificado para todas — un solo par cert/key, lo único que cambia
  por sucursal es el número de punto de venta). El permiso para invocar
  `guardar_comprobante_fiscal()` es `opera_sucursal(sucursal_id)` (dueño,
  o encargado de esa sucursal), no `ve_costos()` — ver
  `20260917090000_arca_multisucursal.sql`. Laprida todavía no está
  habilitada en la práctica porque no tiene fila en `puntos_venta`: falta
  confirmar/dar de alta su número de punto de venta ARCA (lo hace el
  dueño, tiene la clave fiscal). Una vez cargado desde
  `/vender/facturar/configuracion`, factura sin tocar código.
- **Regulación vigente a tener en cuenta (verificado septiembre 2026):**
  - `CondicionIVAReceptorId` es **obligatorio** en todo comprobante desde
    el 1° de septiembre de 2026 (RG 5616 y actualizaciones del manual
    WSFEv1 v4.5–4.7). Sin este campo, ARCA rechaza la emisión — incluso
    en Factura B a Consumidor Final.
  - El **CAE en línea es la modalidad obligatoria** desde el 1° de agosto
    de 2026 (RG 5782/5785). El **CAEA queda reservado solo como
    contingencia** ante caída real del servicio — no se admiten nuevas
    adhesiones a CAEA como modo principal. La implementación de
    contingencia CAEA queda **fuera de alcance de este bloque** (ver
    sección 7).
  - El código QR en el comprobante es obligatorio.

---

## 3. Gap a resolver: no existe ficha de cliente todavía

El CRM de clientes (Parte 24 de `arquitectura.md`) sigue sin implementar.
Pero Factura A exige CUIT + razón social + condición IVA del receptor, y
Factura B (desde septiembre 2026) exige informar la condición IVA aunque
sea "Consumidor Final". Propuesta para no bloquear este bloque en el CRM
completo:

- Al tocar "Facturar":
  - Si se elige **Factura B**: default `CondicionIVAReceptorId` =
    Consumidor Final. Opcionalmente se puede cargar un CUIT si el cliente
    lo pide (por ejemplo, Monotributista que igual quiere B).
  - Si se elige **Factura A**: modal mínimo pidiendo CUIT y razón social.
    Validar el CUIT contra el padrón de ARCA (servicio de consulta,
    padrón A5) antes de enviar la solicitud de CAE, para evitar rechazos.
  - Este formulario mínimo **no reemplaza** el CRM futuro; cuando exista,
    debería poder autocompletar desde ahí. Dejar la tabla de comprobantes
    preparada para vincular a un `cliente_id` opcional a futuro.

Punto de venta: resuelto — uno por sucursal, cualquiera con fila activa en
`puntos_venta` factura (ver sección 2).

---

## 4. Modelo de datos propuesto

```
condicion_iva
  id, codigo_arca, nombre        -- catálogo: RI, Monotributo, Exento, CF, etc.

puntos_venta
  id, sucursal_id (por ahora siempre Olavarría), numero_arca, activo
  -- diseñar la tabla para soportar múltiples puntos de venta a futuro,
  -- aunque hoy solo se cargue uno

comprobantes_fiscales
  id, venta_id (FK, único -- una venta = máximo un comprobante válido),
  tipo_cbte (A=1, B=6),
  punto_venta_id,
  numero_comprobante,
  cae,
  vencimiento_cae,
  condicion_iva_receptor_id (FK a condicion_iva),
  cuit_receptor (nullable),
  razon_social_receptor (nullable),
  importe_total, importe_neto, importe_iva,
  estado ('pendiente', 'autorizado', 'rechazado', 'error'),
  motivo_rechazo (nullable),
  qr_data (texto/URL del código QR generado),
  creado_por, creado_en

comprobantes_fiscales_items
  comprobante_id, venta_item_id, descripcion, cantidad, precio_unitario, subtotal
```

Reglas:
- Igual que el resto del sistema: **el comprobante nunca modifica la
  venta**. Es un registro nuevo que la referencia. Si falla la emisión, la
  venta sigue existiendo normalmente y se puede reintentar facturar.
- Nunca marcar un comprobante como `autorizado` sin CAE válido devuelto
  por ARCA. Ante cualquier duda de estado, `error` y permitir reintento
  manual — no autogenerar reintentos silenciosos.
- Mismo patrón de bloqueo de escritura directa que usan en stock: la tabla
  solo se escribe vía función `SECURITY DEFINER` que orquesta la llamada a
  ARCA y el guardado del resultado.

---

## 5. Flujo funcional

1. Usuario abre una venta ya confirmada → botón **"Facturar"**.
2. Selecciona tipo de comprobante (A o B).
3. Si A: completa CUIT + razón social, sistema valida contra padrón ARCA.
   Si B: confirma Consumidor Final (o carga CUIT opcional).
4. Sistema arma el request `FECAESolicitar` con `CondicionIVAReceptorId`
   incluido, usando el último número de comprobante autorizado + 1 para el
   punto de venta correspondiente (`FECompUltimoAutorizado` primero, para
   evitar duplicar numeración).
5. Si ARCA autoriza: guarda CAE, vencimiento, genera QR, muestra/permite
   imprimir el comprobante.
6. Si ARCA rechaza: guarda el motivo, muestra el error en criollo (no el
   código crudo de ARCA), permite corregir datos y reintentar.
7. Si hay timeout o error de conexión: estado `error`, sin CAE, sin dar la
   operación por perdida — reintentable.

---

## 6. Seguridad / entorno

- El certificado (`.key`/`.crt`) y el Ticket de Acceso (TA) de WSAA se
  manejan **fuera del repo**, como ya está establecido — nunca subir a
  git, variables de entorno / secret manager.
- El TA tiene vigencia de 12 horas; el sistema debe cachearlo y renovarlo
  automáticamente, no pedir uno nuevo por cada venta.
- Homologación y producción usan endpoints y certificados distintos —
  dejar esto configurable por variable de entorno, nunca hardcodeado.

---

## 7. Fuera de alcance de este bloque (explícito)

- Contingencia CAEA real (se implementa más adelante, si hace falta).
- Notas de crédito para devoluciones (ya está anotado como pendiente
  separado en `arquitectura.md`, depende del módulo de devoluciones que
  tampoco existe todavía).
- Envío automático del comprobante por mail/WhatsApp.
- Controlador fiscal físico / impresora fiscal.
- Migración al certificado de producción del cliente (paso manual
  posterior, cuando el circuito esté validado en homologación).

---

## 8. Testing antes de dar el bloque por cerrado

- Emitir al menos una Factura A y una Factura B de prueba en homologación,
  con CUIT real de prueba, y verificar el comprobante contra el servicio
  de consulta de comprobantes de ARCA (no alcanza con que el sistema diga
  "ok" — confirmar que ARCA lo tiene registrado).
- Probar el caso de rechazo (CUIT inválido) y confirmar que la venta
  original queda intacta y facturable de nuevo.
- Confirmar que el QR generado decodifica correctamente los datos del
  comprobante.

---

## 9. Recordatorio de reglas del proyecto

- Mostrar el plan antes de escribir código, esperar aprobación.
- Nunca aplicar migraciones contra Supabase — solo generar el SQL.
- Toda tabla nueva necesita el `GRANT SELECT` explícito de siempre.
- Si aparece una decisión de negocio no cubierta acá, preguntar en vez de
  inventar.
- Actualizar `docs/arquitectura.md` con lo que se decida en este bloque
  apenas se cierre, para que no quede desincronizado del código.
