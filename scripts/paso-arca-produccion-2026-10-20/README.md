# Paso de ARCA de homologación a producción (2026-10-20)

Desde hoy el sistema factura de verdad. Este directorio es el cruce de
ambiente: el SQL que hay que correr y el orden en que va.

**Esto no es una migración.** Se corre una vez, hoy. Borrar comprobantes
fiscales deja de ser aceptable a partir de mañana: los de producción son
documentos fiscales reales y la forma de anular uno es una nota de
crédito, no un `DELETE`.

## Orden

1. **Generar el certificado de producción en el portal de ARCA** (a mano,
   fuera del sistema — ver abajo).
2. `01-diagnostico.sql` — solo lee. Mirá qué comprobantes de homologación
   hay y de qué ventas son.
3. Aplicar la migración `20261020090000_arca_ta_cache_entorno.sql`.
4. `02-limpieza.sql` — borra los comprobantes de homologación. Correr
   **todo junto**: el `set_config` que destraba el trigger de
   inmutabilidad es local a la transacción.
5. **Cargar los números de punto de venta de producción (13 y 14) desde
   `/vender/facturar/configuracion`, con el sistema TODAVÍA en
   homologación.**
6. Recién ahí, cambiar las variables de entorno (`.env.local` y Vercel) y
   redeployar.
7. Sincronizar condiciones de IVA desde esa misma pantalla, y recién
   después emitir la primera factura real.

**El orden de 5 y 6 importa, y es al revés de lo que parece.** Si primero
se cambia el ambiente, queda una ventana en la que el sistema ya habla con
producción pero `puntos_venta` todavía tiene los números de homologación.
Como esos números **existen de verdad en producción** (son los del sistema
viejo, 11 y 12), una venta con tarjeta en ese rato emitiría una factura
real contra el punto de venta de otro sistema. Al revés no hay riesgo: con
el 13 y el 14 cargados y el ambiente todavía en homologación, lo peor que
pasa es que ARCA de homologación rechace una emisión, que no tiene ninguna
consecuencia. Mejor todavía: hacer los dos pasos con el local cerrado.

## Lo que se borra y lo que no

Se borra todo `comprobantes_fiscales` + `comprobantes_fiscales_items`, y
el cache del Ticket de Acceso de WSAA.

**No se toca ninguna venta.** Ni `ventas`, ni `venta_items`, ni
`venta_pagos`, ni `movimientos_stock`, ni `cajas`. El comprobante siempre
fue un registro aparte que referencia a la venta y nunca la modifica
(`docs/arquitectura.md` 1.8, "desacople clave"), así que se puede borrar
el lado fiscal sin tocar el hecho comercial.

### Las ventas del 19 y 20/10 que ya se habían facturado

La facturación automática de las ventas que no son en efectivo arrancó el
2026-10-19, con el sistema ya operando en serio. Esas ventas son reales y
se cobraron, pero su "factura" se emitió contra homologación: no vale
nada ante ARCA.

Decisión del usuario (2026-10-20): **se borran sin re-emitir.**

Y no quedó ningún agujero fiscal: el usuario confirmó después que **esas
10 ventas ya habían sido facturadas con el sistema viejo**, que seguía
operando en paralelo. O sea que tienen factura válida —emitida por el
otro sistema, en su propio punto de venta— y lo único que se borró de acá
fue el registro de homologación, que no valía nada.

Efecto colateral esperado y correcto: el balance de IVA del dueño
(`balance_iva()`) deja de contar el IVA de esos comprobantes. Nunca
fueron facturas reales — no hay nada que declarar por ellas.

## Lo que hay que hacer a mano en el portal de ARCA

Nada de esto lo puede hacer el sistema. Hace falta clave fiscal nivel 3.

1. **Certificado de producción.** El de homologación no sirve en
   producción: son dos PKI distintas. En *Administración de Certificados
   Digitales* se sube un CSR nuevo y se descarga el `.crt`. La clave
   privada (`.key`) se genera localmente y **no se sube a ningún lado**
   (CLAUDE.md, regla ARCA).

   **El certificado vence el 2028-10-19.** Cuando llegue esa fecha hay
   que repetir este trámite (mismo alias o uno nuevo) y recargar
   `ARCA_CERT`/`ARCA_KEY`: si vence sin renovarse, WSAA deja de dar token
   y el sistema no puede facturar más. No hay aviso previo de ARCA.

   Hecho el 2026-10-20: par de claves y CSR generados en
   `C:\Users\Bonet\arca-produccion\` (fuera del repo, a propósito), alias
   **`BebidasMoePOS`**, titular TESTA LUCAS MIGUEL, el mismo CUIT que ya
   usaba homologación. Esa carpeta tiene su propio `LEEME.txt` y los
   scripts para verificar el `.crt` y armar las variables de entorno.
2. **Delegar el servicio WSFE** a ese certificado, en *Administrador de
   Relaciones de Clave Fiscal* → "Facturación Electrónica" (WSFE). El
   CUIT emisor no cambia respecto de homologación (confirmado
   2026-10-20), así que es la misma relación, pero en producción hay que
   darla de alta de nuevo.
3. **Punto de venta — tiene que ser uno propio, no compartido.** En
   *Administración de puntos de venta y domicilios*, dar de alta un punto
   de venta de tipo **"Factura Electrónica - Web Services"** por sucursal
   que vaya a facturar. El número de producción **no tiene por qué
   coincidir** con el que estaba cargado para homologación — el
   diagnóstico imprime los actuales para que se vea la diferencia.

   **El cliente ya tenía otro sistema facturando** (`docs/arquitectura.md`
   1.8: "El cliente ya tiene un sistema que emite facturas A y B") y
   **sigue facturando** — confirmado por el usuario el 2026-10-20. Si los
   dos sistemas comparten punto de venta, se pelean por la numeración:
   cada uno le pide a ARCA el último autorizado y le suma uno, así que dos
   ventas simultáneas pueden pedir el mismo número y una de las dos se
   rechaza. **Cada sistema con su punto de venta.**

   Lo que había en el portal al 2026-10-20 (12 puntos de venta):

   | N° | Sistema | Estado |
   |---|---|---|
   | 1 | Factuweb (imprenta) | activo |
   | 2, 3 | Factura en Línea | activo |
   | 4 a 10 | RECE web services | **de baja** (intentos previos) |
   | 11 | RECE web services, "LOCAL OLAVARRIA" | activo, **del sistema viejo** |
   | 12 | RECE web services, "LOCAL LAPRIDA" | activo, **del sistema viejo** |

   Por eso este sistema usa **13 (Olavarría) y 14 (Laprida)**, dados de
   alta el 2026-10-20 como "RECE para aplicativo y web services". No tocar
   el 11 ni el 12 mientras el sistema viejo siga emitiendo. Si algún día
   se apaga, se puede evaluar unificar — pero eso es una decisión del
   dueño y de su contador, no nuestra.

   Un punto de venta **no se borra, solo se da de baja** (por eso hay
   siete muertos en la lista). Un número usado no se puede volver a crear.

## Variables de entorno

**Solo en Vercel** (environment Production), y **redeployar** — Vercel no
toma variables nuevas sin un deploy:

| Variable | Qué cambia |
|---|---|
| `ARCA_ENTORNO` | `homologacion` → `produccion` |
| `ARCA_CERT` | el `.crt` de producción (PEM completo) |
| `ARCA_KEY` | la clave privada de producción (PEM completo) |
| `ARCA_CUIT` | **no cambia** (confirmado 2026-10-20) |

**`.env.local` queda en homologación** (decisión del usuario 2026-10-20).
Desarrollo sigue hablando con el ARCA de prueba, así que una venta hecha
con `npm run dev` no puede emitir una factura real por accidente —
importa, porque el sistema no tiene notas de crédito para anularla. Los
dos ambientes conviven sin pisarse gracias a que el cache del Ticket de
Acceso está indexado por `(entorno, servicio)`.

Si alguna vez hace falta probar producción desde local, se cambian las
tres variables a mano y **se vuelven atrás al terminar**. La pantalla
`/vender/facturar/configuracion` dice en qué ambiente está, para no
quedarse colgado sin darse cuenta.

El sistema no necesita ningún cambio de código para cambiar de ambiente:
los endpoints de producción ya estaban en `lib/arca/env.ts` desde el
principio, y la numeración se le pide a ARCA con `FECompUltimoAutorizado`
antes de cada CAE, así que arranca sola en el número correcto.

## Primera emisión real: en orden de riesgo creciente

1. **Sincronizar condiciones de IVA** (`/vender/facturar/configuracion`).
   Es una llamada de solo lectura a ARCA: si el certificado, la
   delegación y el CUIT están bien, trae el catálogo. Si falla acá, no
   hay nada emitido todavía.
2. **Una Factura B chica de verdad**, de una venta real.
3. **Verificarla contra ARCA** con el botón "Verificar" del detalle de la
   venta: consulta `FECompConsultar` y compara lo que ARCA tiene
   registrado con lo que guardamos. Que el sistema diga "autorizado" no
   alcanza.
4. Reconfirmar que el cartel de `/vender/facturar/configuracion` dice
   **Producción**.
