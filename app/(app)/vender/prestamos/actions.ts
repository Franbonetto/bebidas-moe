"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { verificarPinOperaciones } from "@/lib/pin";

export type ItemPrestamo = { skuId: string; cantidad: number };

function validarItems(items: ItemPrestamo[]): string | null {
  if (items.length === 0) return "Agregá al menos un producto.";
  for (const item of items) {
    if (!item.skuId) return "Falta el producto en alguna línea.";
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      return "Las cantidades tienen que ser números enteros mayores a cero.";
    }
  }
  return null;
}

// Registra un préstamo de mercadería a un proveedor (pedido del usuario
// 2026-10-31): no es una venta -- no cobra, no toca caja, no se factura --
// pero igual descuenta stock real, así que necesita PIN como el resto de
// las pantallas que tocan stock fuera de una venta. Ver
// supabase/migrations/20261031090000_prestamos_proveedor.sql.
export async function registrarPrestamo(
  proveedorId: string,
  items: ItemPrestamo[],
  nota: string,
  fechaEstimadaDevolucion: string | null,
  pin: string,
): Promise<{ error: string } | { ok: true }> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  if (!proveedorId) return { error: "Elegí el proveedor." };

  const errorItems = validarItems(items);
  if (errorItems) return { error: errorItems };

  const supabase = await createClient();

  const { error } = await supabase.rpc("registrar_prestamo_proveedor", {
    p_proveedor_id: proveedorId,
    p_items: items.map((i) => ({ sku_id: i.skuId, cantidad: i.cantidad })),
    p_nota: nota.trim() || null,
    p_fecha_estimada_devolucion: fechaEstimadaDevolucion,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender/prestamos");
  revalidatePath("/vender");
  revalidatePath("/reportes/alertas");
  return { ok: true };
}

// Reintegra lo que trajo el proveedor -- total o parcial (decisión del
// usuario: puede devolver de a partes). El SQL cierra el préstamo solo
// cuando no queda nada pendiente en ningún ítem.
export async function reintegrarPrestamo(
  prestamoId: string,
  items: ItemPrestamo[],
  pin: string,
): Promise<{ error: string } | { ok: true }> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const errorItems = validarItems(items);
  if (errorItems) return { error: errorItems };

  const supabase = await createClient();

  const { error } = await supabase.rpc("reintegrar_prestamo_proveedor", {
    p_prestamo_id: prestamoId,
    p_items: items.map((i) => ({ sku_id: i.skuId, cantidad: i.cantidad })),
  });

  if (error) return { error: error.message };

  revalidatePath("/vender/prestamos");
  revalidatePath("/vender");
  revalidatePath("/reportes/alertas");
  return { ok: true };
}
