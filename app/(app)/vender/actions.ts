"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LineaVenta = {
  sku_id: string;
  cantidad: number;
  precio_unitario: number;
  precio_lista_unitario: number;
  promocion_id: string | null;
  con_envase: boolean;
};

export async function confirmarVenta(
  sucursalId: string,
  medioPago: "efectivo" | "debito" | "credito" | "transferencia",
  lineas: LineaVenta[],
): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("confirmar_venta", {
    p_sucursal_id: sucursalId,
    p_medio_pago: medioPago,
    p_lineas: lineas,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender");
  return { id: (data as { id: string }).id };
}

// Encadena desarmar_sku() los niveles que hagan falta (x24 -> x6 -> unidad,
// arquitectura.md 1.3: "la cascada se encadena sola") para cubrir una
// cantidad faltante de `skuId`. `cadena` la arma el cliente (conoce el
// catálogo completo ya cargado en la página) con el orden de SKU a
// desarmar de arriba hacia abajo; cada paso es una llamada separada a
// desarmar_sku() porque esa función es de un solo nivel por decisión
// propia (bloque 3: "una decisión humana repetida en el POS, no una
// cascada automática de la base de datos").
export async function desarmarParaVenta(
  sucursalId: string,
  cadena: { skuId: string; cantidad: number }[],
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  for (const paso of cadena) {
    const { error } = await supabase.rpc("desarmar_sku", {
      p_sku_id: paso.skuId,
      p_sucursal_id: sucursalId,
      p_cantidad: paso.cantidad,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/vender");
  return { ok: true };
}

export async function cerrarCaja(
  cajaId: string,
  efectivoDeclarado: number,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("cerrar_caja", {
    p_caja_id: cajaId,
    p_efectivo_declarado: efectivoDeclarado,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender");
  revalidatePath("/vender/caja");
  return { ok: true };
}
