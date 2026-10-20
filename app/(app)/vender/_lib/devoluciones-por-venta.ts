import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodoPorLotes } from "@/lib/supabase/traer-todo";
import type { EstadoDevolucion } from "./devolucion-estado";

/**
 * Para cada venta de `ventaIds` que tenga devoluciones, si volvió toda la
 * mercadería ('total') o parte ('parcial'). Las ventas sin devoluciones no
 * aparecen en el Map.
 *
 * Se cuenta por unidades, no por líneas: una venta de 3 botellas con 1
 * devuelta es 'parcial'. El reembolso en dinero no entra en la cuenta --
 * una devolución resuelta como cambio de producto también deja la venta
 * marcada, porque la mercadería volvió igual.
 *
 * Las dos consultas van por lotes (traerTodoPorLotes): una lista de 90
 * días de ventas pasa largo los 500 ids por URL y el tope de 1000 filas.
 */
export async function devolucionesPorVenta(
  supabase: SupabaseClient,
  ventaIds: string[],
): Promise<Map<string, EstadoDevolucion>> {
  const estados = new Map<string, EstadoDevolucion>();
  if (ventaIds.length === 0) return estados;

  const { data: items } = await traerTodoPorLotes<{
    id: string;
    venta_id: string;
    cantidad: number;
  }>(ventaIds, (lote) =>
    supabase.from("venta_items").select("id, venta_id, cantidad").in("venta_id", lote),
  );

  const itemIds = (items ?? []).map((it) => it.id);
  if (itemIds.length === 0) return estados;

  const { data: devueltos } = await traerTodoPorLotes<{
    venta_item_id: string;
    cantidad: number;
  }>(itemIds, (lote) =>
    supabase.from("devolucion_items").select("venta_item_id, cantidad").in("venta_item_id", lote),
  );

  const devueltoPorItem = new Map<string, number>();
  for (const d of devueltos ?? []) {
    devueltoPorItem.set(d.venta_item_id, (devueltoPorItem.get(d.venta_item_id) ?? 0) + d.cantidad);
  }

  if (devueltoPorItem.size === 0) return estados;

  const porVenta = new Map<string, { vendidas: number; devueltas: number }>();
  for (const it of items ?? []) {
    const acum = porVenta.get(it.venta_id) ?? { vendidas: 0, devueltas: 0 };
    acum.vendidas += it.cantidad;
    acum.devueltas += devueltoPorItem.get(it.id) ?? 0;
    porVenta.set(it.venta_id, acum);
  }

  for (const [ventaId, { vendidas, devueltas }] of porVenta) {
    if (devueltas <= 0) continue;
    estados.set(ventaId, devueltas >= vendidas ? "total" : "parcial");
  }

  return estados;
}
