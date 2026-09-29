import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esDueno } from "@/lib/permisos";

// Todo /reportes es del dueño. El balance de IVA es rentabilidad global
// (CLAUDE.md, matriz de roles: "Rentabilidad global: sí / no / no"), así que
// ni el encargado de Olavarría entra -- él ve costos y márgenes, no el
// resultado fiscal de la empresa. La base lo vuelve a chequear adentro de
// cada función (ve_rentabilidad_global()): esto es solo para no mostrar una
// pantalla que después va a fallar.
export default async function ReportesLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  if (!(await esDueno(supabase))) {
    redirect("/");
  }

  return <>{children}</>;
}
