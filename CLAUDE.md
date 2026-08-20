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
| Auditoría y usuarios | sí | **no** | **no** |

Los encargados **no son simétricos**: Olavarría maneja el abastecimiento de toda la
empresa, por eso ve costos. Laprida no.

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
Vigencia opcional (sin fechas = permanente).
**Advertir siempre** si el precio final queda bajo el costo (avisar, no bloquear).
Al encargado de Laprida se le advierte sin mostrarle el número del costo.

### Efectivo = billete en mano
Débito, crédito y transferencia **no** cuentan como efectivo.
Las promociones aplican solo pagando en efectivo.

### POS
- Medio de pago **al final**, antes de cobrar.
- Si hay promociones en el ticket, mostrar los dos totales (efectivo / otro medio).
  Si no hay promociones, un solo total.
- Sin stock: **permitir vender**, advertir, y marcar el SKU para revisión de inventario.
- Caja diaria por sucursal.

### Costo
Historial completo por lote/recepción. El stock **no** rastrea de qué lote sale cada
unidad. `costo_actual` = costo del último lote recibido. Preparado para migrar a FIFO
sin perder datos.

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

## FUERA DE ALCANCE (por ahora)

- **Facturación ARCA.** El cliente ya factura con otro sistema. El objeto `venta` debe
  quedar desacoplado de un futuro objeto `comprobante`, pero no implementar nada fiscal.
- CRM de clientes (etapa posterior).
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
