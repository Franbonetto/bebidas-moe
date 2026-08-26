"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Resultado = { error: string } | { ok: true };

async function registrarMovimientoEnvase(
  tipoEnvaseId: string,
  sucursalId: string,
  tipo: "ingreso_cliente" | "devolucion_proveedor" | "ajuste",
  cantidad: number,
  motivo: string | null,
): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("registrar_movimiento_envase", {
    p_tipo_envase_id: tipoEnvaseId,
    p_sucursal_id: sucursalId,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_motivo: motivo,
  });

  if (error) return { error: error.message };

  revalidatePath("/envases");
  return { ok: true };
}

// Devuelve el depósito cobrado en la venta (arquitectura.md 1.4): eso es un
// movimiento de caja, no de envases, y todavía no hay caja (bloque 6) donde
// registrarlo. Acá solo se registra el ingreso del vacío al stock.
export async function registrarDevolucionSueltos(
  tipoEnvaseId: string,
  sucursalId: string,
  cantidad: number,
) {
  return registrarMovimientoEnvase(tipoEnvaseId, sucursalId, "ingreso_cliente", cantidad, null);
}

export async function registrarDevolucionProveedor(
  tipoEnvaseId: string,
  sucursalId: string,
  cantidad: number,
) {
  return registrarMovimientoEnvase(
    tipoEnvaseId,
    sucursalId,
    "devolucion_proveedor",
    cantidad,
    null,
  );
}

export async function registrarAjusteEnvase(
  tipoEnvaseId: string,
  sucursalId: string,
  delta: number,
  motivo: string,
) {
  return registrarMovimientoEnvase(tipoEnvaseId, sucursalId, "ajuste", delta, motivo);
}
