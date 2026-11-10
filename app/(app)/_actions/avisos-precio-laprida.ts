"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Marca avisos de precio/promo de Laprida como resueltos ("ya cambié el
// cartel"). Sin PIN: es lo opuesto de sensible, es la empleada confirmando
// que hizo el trabajo físico de cambiar el cartel.

function revalidar() {
  revalidatePath("/");
  revalidatePath("/reportes/alertas");
  revalidatePath("/precios");
}

// Un cartel: resuelve todas las filas pendientes de ese producto o promo.
export async function marcarAvisoPrecioResuelto(ids: string[]): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  for (const id of ids) {
    const { error } = await supabase.rpc("marcar_aviso_precio_resuelto", { p_id: id });
    if (error) return { error: error.message };
  }

  revalidar();
  return { ok: true };
}

// "Ya cambié todos los carteles": una sola llamada, no una por aviso.
// Requiere 20261110090000_avisos_precio_resolver_todos.sql.
export async function marcarTodosAvisosPrecioResueltos(): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("marcar_avisos_precio_resueltos");
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}
