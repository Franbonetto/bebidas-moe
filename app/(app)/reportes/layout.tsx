import type { ReactNode } from "react";

// Reportes es la categoría de todo lo que se mira sin operar: caja y
// dinero, productos y stock, alertas y el balance de IVA
// (reorganización pedida por el usuario 2026-10-19).
//
// El permiso NO se decide acá. Antes este layout redirigía a cualquiera
// que no fuera el dueño, porque /reportes solo tenía el balance de IVA
// (rentabilidad global, CLAUDE.md). Ahora /reportes/alertas vive adentro y
// esa pantalla es de los tres roles, así que cada página pide lo que
// necesita con exigirDueno() -- ver _lib/permiso.ts.
export default function ReportesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
