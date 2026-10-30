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
  revalidatePath(`/proveedores/${id}`);
  return { ok: true };
}

export type TipoAjusteCuentaProveedor = "aumento_deuda" | "credito_a_favor";

// Cuenta aparte con el proveedor, fuera de boleta por boleta: deuda que el
// dueño carga a mano (ej. un saldo de antes de usar el sistema) o un
// crédito a favor. Privado del dueño -- registrar_ajuste_cuenta_proveedor()
// lo valida en la base. Sin PIN: pantalla privada del dueño, no el mostrador
// (pedido del usuario 2026-10-30).
export async function registrarAjusteCuentaProveedor(datos: {
  proveedor_id: string;
  tipo: TipoAjusteCuentaProveedor;
  monto: number;
  nota: string;
}): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  if (!Number.isFinite(datos.monto) || datos.monto <= 0)
    return { error: "El monto tiene que ser mayor a cero." };
  if (!datos.nota.trim()) return { error: "Escribí una nota: qué es y por qué." };

  const { error } = await supabase.rpc("registrar_ajuste_cuenta_proveedor", {
    p_proveedor_id: datos.proveedor_id,
    p_tipo: datos.tipo,
    p_monto: datos.monto,
    p_nota: datos.nota.trim(),
  });

  if (error) return { error: error.message };

  revalidatePath(`/proveedores/${datos.proveedor_id}`);
  revalidatePath("/proveedores");
  return { ok: true };
}
