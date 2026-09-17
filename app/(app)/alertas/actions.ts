"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function guardarPreferenciaAlerta(
  categoria: string,
  visible: boolean,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No hay sesión activa." };

  const { error } = await supabase
    .from("preferencias_alerta")
    .upsert({ usuario_id: user.id, categoria, visible }, { onConflict: "usuario_id,categoria" });

  if (error) return { error: error.message };

  revalidatePath("/alertas");
  return { ok: true };
}
