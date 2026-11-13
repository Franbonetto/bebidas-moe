"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { verificarPinOperaciones } from "@/lib/pin";

export type ItemConsignacion = { skuId: string; cantidad: number };

function validarItems(items: ItemConsignacion[]): string | null {
  if (items.length === 0) return "Agregá al menos un producto.";
  for (const item of items) {
    if (!item.skuId) return "Falta el producto en alguna línea.";
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      return "Las cantidades tienen que ser números enteros mayores a cero.";
    }
  }
  return null;
}

// Entrega mercadería en consignación a un cliente (pedido del usuario
// 2026-11-12): no es una venta -- no cobra, no toca caja, no se factura --
// pero igual descuenta stock real, así que pide PIN como el resto de las
// pantallas que tocan stock fuera de una venta. Ver
// supabase/migrations/20261112090000_consignaciones.sql.
export async function registrarConsignacion(
  clienteNombre: string,
  clienteTelefono: string,
  nota: string,
  items: ItemConsignacion[],
  fechaEstimadaDevolucion: string | null,
  pin: string,
): Promise<{ error: string } | { ok: true }> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  if (!clienteNombre.trim()) return { error: "Falta el nombre del cliente." };

  const errorItems = validarItems(items);
  if (errorItems) return { error: errorItems };

  const supabase = await createClient();

  const { error } = await supabase.rpc("registrar_consignacion", {
    p_cliente_nombre: clienteNombre.trim(),
    p_cliente_telefono: clienteTelefono.trim() || null,
    p_nota: nota.trim() || null,
    p_items: items.map((i) => ({ sku_id: i.skuId, cantidad: i.cantidad })),
    p_fecha_estimada_devolucion: fechaEstimadaDevolucion,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender/consignaciones");
  revalidatePath("/vender");
  revalidatePath("/reportes/alertas");
  return { ok: true };
}

// El cliente no vendió nada: devuelve todo. No hay cobro de por medio, así
// que no pasa por el POS ni por confirmar_venta() -- solo repone el stock y
// cierra la consignación.
export async function liquidarConsignacionSinVenta(
  consignacionId: string,
  pin: string,
): Promise<{ error: string } | { ok: true }> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const supabase = await createClient();

  const { error } = await supabase.rpc("liquidar_consignacion_sin_venta", {
    p_consignacion_id: consignacionId,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender/consignaciones");
  revalidatePath("/vender");
  revalidatePath("/reportes/alertas");
  return { ok: true };
}
