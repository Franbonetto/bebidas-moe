"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type DatosProveedor = {
  razon_social: string;
  nombre_comercial: string | null;
  cuit: string | null;
  contacto: string | null;
  whatsapp: string | null;
  email: string | null;
  direccion: string | null;
  condicion_pago: string | null;
  plazo_dias: number | null;
  observaciones: string | null;
  activo: boolean;
};

export async function crearProveedor(
  datos: DatosProveedor,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("proveedores").insert(datos);
  if (error) return { error: error.message };

  revalidatePath("/proveedores");
  return { ok: true };
}

export async function actualizarProveedor(
  id: string,
  datos: DatosProveedor,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("proveedores").update(datos).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/proveedores");
  return { ok: true };
}
