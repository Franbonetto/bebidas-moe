"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LineaCompra = {
  sku_id: string;
  cantidad: number;
  costo_unitario: number;
};

function validarLineas(lineas: LineaCompra[]): string | null {
  if (lineas.length === 0) return "Agregá al menos una línea.";
  for (const l of lineas) {
    if (!l.sku_id) return "Falta seleccionar el SKU en alguna línea.";
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0)
      return "La cantidad tiene que ser un entero mayor a cero.";
    if (typeof l.costo_unitario !== "number" || l.costo_unitario < 0)
      return "El costo unitario no puede ser negativo.";
  }
  return null;
}

// Único camino para cargar una compra (arquitectura.md 1.6, decisión del
// usuario 2026-09-21: "no trabaja así el local" -- se sacó el flujo de
// "Nueva compra" en varias tandas/borrador, siempre llega todo junto).
// cargar_compra_directa() crea la compra, la confirma, la recibe completa
// y actualiza stock/costo/precio en una sola transacción.
export async function cargarCompraDirecta(datos: {
  proveedor_id: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  lineas: LineaCompra[];
}): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  if (!datos.proveedor_id) return { error: "Elegí un proveedor." };

  const errorLineas = validarLineas(datos.lineas);
  if (errorLineas) return { error: errorLineas };

  const { data, error } = await supabase.rpc("cargar_compra_directa", {
    p_proveedor_id: datos.proveedor_id,
    p_numero_factura: datos.numero_factura,
    p_fecha_factura: datos.fecha_factura,
    p_lineas: datos.lineas,
  });

  if (error) return { error: error.message };

  revalidatePath("/compras");
  revalidatePath("/productos");
  return { id: data as string };
}
