"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function iniciarInventario(
  sucursalId: string,
  tipo: "general" | "categoria" | "puntual",
  categoriaId: string | null,
  skuIds: string[] | null,
): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("iniciar_inventario", {
    p_sucursal_id: sucursalId,
    p_tipo: tipo,
    p_categoria_id: categoriaId,
    p_sku_ids: skuIds,
  });

  if (error) return { error: error.message };

  revalidatePath("/inventarios");
  return { id: (data as { id: string }).id };
}

export type LineaConteo = { sku_id: string; stock_contado: number; motivo: string | null };

export async function guardarConteo(
  inventarioId: string,
  items: LineaConteo[],
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("guardar_conteo", {
    p_inventario_id: inventarioId,
    p_items: items,
  });

  if (error) return { error: error.message };

  revalidatePath(`/inventarios/${inventarioId}`);
  return { ok: true };
}

export async function confirmarInventario(
  inventarioId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("confirmar_inventario", { p_inventario_id: inventarioId });
  if (error) return { error: error.message };

  revalidatePath(`/inventarios/${inventarioId}`);
  revalidatePath("/inventarios");
  revalidatePath("/productos");
  return { ok: true };
}
