"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MOTIVOS_MERMA, type MotivoMerma } from "./_lib/motivos";

// Solo el stock: a diferencia de la carga inicial, acá no se lee costo ni
// precio -- esta pantalla la usa también el encargado de Laprida, que no ve
// costos.
export async function stockActualDeSku(
  skuId: string,
  sucursalId: string,
): Promise<{ error: string } | { stock: number }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("stock_sucursal")
    .select("cantidad")
    .eq("sku_id", skuId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle();

  if (error) return { error: error.message };
  return { stock: data?.cantidad ?? 0 };
}

export async function registrarMerma(datos: {
  sku_id: string;
  sucursal_id: string;
  cantidad: number;
  motivo: MotivoMerma;
  // Quién la registra: en el mostrador comparten la sesión del encargado,
  // así que el usuario logueado no alcanza para saber de quién fue.
  empleado_id: string;
  detalle: string | null;
}): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  if (!Number.isInteger(datos.cantidad) || datos.cantidad <= 0)
    return { error: "La cantidad tiene que ser un número entero mayor a cero." };

  if (!MOTIVOS_MERMA.includes(datos.motivo)) return { error: "Elegí un motivo." };

  if (!datos.empleado_id) return { error: "Elegí quién la registra." };

  if (datos.motivo === "otro" && !datos.detalle?.trim())
    return { error: 'Si el motivo es "otro", explicá qué pasó.' };

  const { error } = await supabase.rpc("registrar_merma", {
    p_sku_id: datos.sku_id,
    p_sucursal_id: datos.sucursal_id,
    p_cantidad: datos.cantidad,
    p_motivo: datos.motivo,
    p_empleado_id: datos.empleado_id,
    p_detalle: datos.detalle?.trim() || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/mermas");
  revalidatePath("/productos");
  return { ok: true };
}
