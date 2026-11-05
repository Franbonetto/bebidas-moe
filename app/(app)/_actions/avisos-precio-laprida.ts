"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Marca un aviso de precio/promo de Laprida como resuelto ("ya cambié el
// cartel"). Sin PIN: es lo opuesto de sensible, es la empleada confirmando
// que hizo el trabajo físico de cambiar el cartel.
export async function marcarAvisoPrecioResuelto(id: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("marcar_aviso_precio_resuelto", { p_id: id });
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/reportes/alertas");
  revalidatePath("/precios");
  return { ok: true };
}
