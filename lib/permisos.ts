import type { SupabaseClient } from "@supabase/supabase-js";

// Espejo en el cliente de la funcion SQL ve_costos() (bloque 1): dueño +
// encargado de Olavarria. Unica fuente de verdad es la funcion de base de
// datos -- esto solo la expone al front en vez de reimplementar la logica.
export async function veCostos(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("ve_costos");
  return data === true;
}
