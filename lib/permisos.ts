import type { SupabaseClient } from "@supabase/supabase-js";

// Espejo en el cliente de la funcion SQL ve_costos() (bloque 1): dueño +
// encargado de Olavarria. Unica fuente de verdad es la funcion de base de
// datos -- esto solo la expone al front en vez de reimplementar la logica.
export async function veCostos(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("ve_costos");
  return data === true;
}

// Espejo de es_dueno() (bloque 1). OJO: ya no es "el unico que toca
// precios". Arquitectura.md 1.11 decia eso, pero la decision del
// 2026-10-08 (CLAUDE.md, "Precios de venta: control detectivo, no
// preventivo") paso la carga de precios a ve_costos() -- dueño + encargado
// de Olavarria --, y lo mismo vale para el recargo por frio y el lapiz del
// POS (2026-10-17). es_dueno() queda para lo que de verdad es solo del
// dueño: las politicas de precios, la rentabilidad global, auditoria y
// usuarios.
export async function esDueno(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("es_dueno");
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

// Espejo de opera_central() (bloque 1): dueño, o encargado asignado a la
// sucursal central (Olavarría). Se usa para decidir qué panel de Inicio
// mostrarle a un encargado sin tener que hardcodear "Olavarría".
export async function operaCentral(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("opera_central");
  return data === true;
}
