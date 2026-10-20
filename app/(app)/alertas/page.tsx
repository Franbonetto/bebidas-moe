import { redirect } from "next/navigation";

// Las alertas se mudaron a /reportes/alertas el 2026-10-19, cuando todo lo
// que era "mirar" pasó a vivir bajo Reportes. Esta redirección queda para
// los links viejos y para el favorito que el dueño pueda tener guardado en
// el celular.
export default function AlertasRedirect() {
  redirect("/reportes/alertas");
}
