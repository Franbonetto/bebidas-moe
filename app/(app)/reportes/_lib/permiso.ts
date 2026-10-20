import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { esDueno } from "@/lib/permisos";

// Reportes de dinero y de costos: solo el dueño (CLAUDE.md, matriz de
// roles -- "Rentabilidad global: sí / no / no"). Ni el encargado de
// Olavarría, que ve costos y márgenes pero no el resultado de la empresa.
//
// La base lo vuelve a chequear en cada función y en las políticas de RLS:
// esto es solo para no mostrar una pantalla que después va a venir vacía.
export async function exigirDueno(supabase: SupabaseClient): Promise<void> {
  if (!(await esDueno(supabase))) redirect("/");
}
