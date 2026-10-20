import { ZONA_ARGENTINA } from "@/lib/fecha";

export const formatoMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

// El pie de la factura se compara contra el papel, donde los centavos
// existen ($747.583,50). Solo para esos montos: el resto de la pantalla
// sigue redondeado.
export const formatoMonedaExacto = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatoFecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" });

// Zona fija (2026-10-19). Estas pantallas se arman en el SERVIDOR, que
// corre en UTC: sin esto, una venta de las 19:40 se imprimía en el ticket
// del cliente como las 22:40. En el navegador se veía bien, lo que hacía
// mas dificil notarlo -- y además provocaba que el HTML del servidor y el
// del cliente no coincidieran.
//
// Solo lleva zona el formato CON hora. `formatoFecha` se usa también sobre
// columnas `date` pelado (fecha de factura, vigencias), donde "2026-10-01"
// se interpreta como medianoche UTC: fijarle la zona de Argentina lo
// correría al día anterior.
export const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: ZONA_ARGENTINA,
});

// Solo la hora, para el ticket de cierre de caja.
export const formatoHora = new Intl.DateTimeFormat("es-AR", {
  timeStyle: "short",
  timeZone: ZONA_ARGENTINA,
});
