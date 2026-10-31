import { ZONA_ARGENTINA } from "@/lib/fecha";

export const formatoFecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" });

export const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: ZONA_ARGENTINA,
});
