export const formatoMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export const formatoFecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" });
