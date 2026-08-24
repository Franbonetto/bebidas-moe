import type { SupabaseClient } from "@supabase/supabase-js";

// Espejo en el cliente de la funcion SQL ve_costos() (bloque 1): dueño +
// encargado de Olavarria. Unica fuente de verdad es la funcion de base de
// datos -- esto solo la expone al front en vez de reimplementar la logica.
export async function veCostos(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("ve_costos");
  return data === true;
}

// Espejo de opera_sucursal(sucursal_id) (bloque 1): dueño, o encargado
// asignado a esa sucursal. Se usa para decidir, por ejemplo, si el usuario
// puede armar/enviar un pedido de Laprida o preparar/despachar uno como
// Olavarría.
export async function operaSucursal(
  supabase: SupabaseClient,
  sucursalId: string,
): Promise<boolean> {
  const { data } = await supabase.rpc("opera_sucursal", { p_sucursal_id: sucursalId });
  return data === true;
}
