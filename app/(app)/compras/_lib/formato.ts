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

export const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});
