"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MOTIVOS_MERMA, type MotivoMerma } from "./_lib/motivos";

// Stock y vencimiento del último lote: a diferencia de la carga inicial, acá
// no se lee costo ni precio -- esta pantalla la usa también el encargado de
// Laprida, que no ve costos.
//
// El vencimiento se trae para precargarlo cuando el motivo es "vencido": el
// sistema ya sabe qué decía el último lote, así que no tiene sentido hacer
// que lo tipeen de nuevo (igual se puede corregir, porque en la góndola
// puede haber mercadería de un lote anterior).
export async function datosSkuParaMerma(
  skuId: string,
  sucursalId: string,
): Promise<{ error: string } | { stock: number; vencimientoUltimoLote: string | null }> {
  const supabase = await createClient();

  const [{ data: stock, error }, { data: lote }] = await Promise.all([
    supabase
      .from("stock_sucursal")
      .select("cantidad")
      .eq("sku_id", skuId)
      .eq("sucursal_id", sucursalId)
      .maybeSingle(),
    supabase
      .from("historial_costos")
      .select("fecha_vencimiento")
      .eq("sku_id", skuId)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (error) return { error: error.message };
  return {
    stock: stock?.cantidad ?? 0,
    vencimientoUltimoLote: lote?.fecha_vencimiento ?? null,
  };
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
  // Solo cuando el motivo es "vencido": cuándo vencía lo que se tira.
  fecha_vencimiento: string | null;
}): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  if (!Number.isInteger(datos.cantidad) || datos.cantidad <= 0)
    return { error: "La cantidad tiene que ser un número entero mayor a cero." };

  if (!MOTIVOS_MERMA.includes(datos.motivo)) return { error: "Elegí un motivo." };

  if (!datos.empleado_id) return { error: "Elegí quién la registra." };

  if (datos.motivo === "otro" && !datos.detalle?.trim())
    return { error: 'Si el motivo es "otro", explicá qué pasó.' };

  if (datos.motivo === "vencido" && !datos.fecha_vencimiento)
    return { error: "Indicá cuándo vencía." };

  const { error } = await supabase.rpc("registrar_merma", {
    p_sku_id: datos.sku_id,
    p_sucursal_id: datos.sucursal_id,
    p_cantidad: datos.cantidad,
    p_motivo: datos.motivo,
    p_empleado_id: datos.empleado_id,
    p_detalle: datos.detalle?.trim() || null,
    p_fecha_vencimiento: datos.motivo === "vencido" ? datos.fecha_vencimiento : null,
  });

  if (error) return { error: error.message };

  revalidatePath("/mermas");
  revalidatePath("/productos");
  return { ok: true };
}
