import { redirect } from "next/navigation";

// Los productos particulares pasaron a ser una sección del reporte de caja
// el 2026-10-19: son plata que entró sin pasar por el catálogo, así que se
// leen al lado de las ventas y no en una pantalla propia. Queda la
// redirección por los links viejos.
export default function ParticularesRedirect() {
  redirect("/reportes/caja");
}
