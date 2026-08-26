import { createClient } from "@/lib/supabase/server";
import { operaCentral } from "@/lib/permisos";
import { DuenoDashboard } from "./_components/dashboard/dueno-dashboard";
import { OlavarriaDashboard } from "./_components/dashboard/olavarria-dashboard";
import { LapridaDashboard } from "./_components/dashboard/laprida-dashboard";

export default async function InicioPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", user!.id)
    .maybeSingle();

  if (usuario?.rol === "dueno") {
    return <DuenoDashboard />;
  }

  // Encargado: Olavarría (central) ve el panel de abastecimiento, Laprida
  // ve el de reposición (arquitectura.md 1.13, tres paneles independientes).
  if (await operaCentral(supabase)) {
    return <OlavarriaDashboard />;
  }

  return <LapridaDashboard />;
}
