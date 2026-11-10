import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase/traer-todo";

// Lo que se vendió / se mandó por SKU en un tramo de tiempo. Lo usan el envío
// de Olavarría a Laprida y el pedido de compra de Olavarría. No es una
// acción de servidor (vive acá y no en actions.ts) porque también la llaman
// las páginas.

// Unidades vendidas por SKU en una sucursal (ventas confirmadas) dentro de
// [desdeIso, hastaIso). Cualquiera de los dos puede ser null (sin tope).
// Mismo patrón de agregación que /reportes/stock (ventas confirmadas ->
// venta_items por lotes).
export async function vendidoPorSku(
  supabase: SupabaseClient,
  sucursalId: string,
  desdeIso: string | null,
  hastaIso: string | null,
): Promise<Map<string, number>> {
  let ventasQuery = supabase.from("ventas").select("id").eq("sucursal_id", sucursalId).eq("estado", "confirmada");
  if (desdeIso) ventasQuery = ventasQuery.gte("fecha", desdeIso);
  if (hastaIso) ventasQuery = ventasQuery.lt("fecha", hastaIso);
  const { data: ventas } = await traerTodo(ventasQuery);

  const idsVentas = (ventas ?? []).map((v: { id: string }) => v.id);
  const { data: itemsRaw } = idsVentas.length
    ? await traerTodoPorLotes<{ sku_id: string | null; cantidad: number }>(idsVentas, (lote) =>
        supabase.from("venta_items").select("sku_id, cantidad").in("venta_id", lote),
      )
    : { data: [] };

  const vendido = new Map<string, number>();
  for (const it of itemsRaw ?? []) {
    if (it.sku_id == null) continue;
    vendido.set(it.sku_id, (vendido.get(it.sku_id) ?? 0) + it.cantidad);
  }
  return vendido;
}

// Unidades que salieron de una sucursal hacia otra (transferencias,
// cualquiera sea su estado) dentro de [desdeIso, hastaIso). Es mercadería
// que dejó de estar en el local sin ser una venta: el pedido de compra de
// Olavarría la muestra aparte para no confundir "se vendió poco" con "hay
// poco porque se mandó a Laprida".
export async function enviadoPorSku(
  supabase: SupabaseClient,
  origenId: string,
  desdeIso: string | null,
  hastaIso: string | null,
): Promise<Map<string, number>> {
  let consulta = supabase
    .from("transferencia_items")
    .select(
      "id, sku_id, cantidad_despachada, transferencia:transferencias!inner ( fecha_despacho, sucursal_origen_id )",
    )
    .eq("transferencia.sucursal_origen_id", origenId);
  if (desdeIso) consulta = consulta.gte("transferencia.fecha_despacho", desdeIso);
  if (hastaIso) consulta = consulta.lt("transferencia.fecha_despacho", hastaIso);

  const { data } = await traerTodo(consulta);

  const enviado = new Map<string, number>();
  for (const it of (data ?? []) as unknown as { sku_id: string; cantidad_despachada: number }[]) {
    enviado.set(it.sku_id, (enviado.get(it.sku_id) ?? 0) + it.cantidad_despachada);
  }
  return enviado;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Dos días (AAAA-MM-DD, inclusivos, día de Argentina -- ver lib/fecha.ts) a
// [desdeIso, hastaIso) para consultar.
export function limitesDeRango(
  desde: string,
  hasta: string,
): { error: string } | { desdeIso: string; hastaIso: string } {
  if (!FECHA_ISO.test(desde) || !FECHA_ISO.test(hasta)) return { error: "Elegí las dos fechas." };
  if (desde > hasta) return { error: 'La fecha "desde" no puede ser posterior a "hasta".' };

  const inicio = new Date(`${desde}T00:00:00-03:00`);
  const finExclusivo = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(finExclusivo.getTime())) {
    return { error: "Fecha inválida." };
  }
  return { desdeIso: inicio.toISOString(), hastaIso: finExclusivo.toISOString() };
}
