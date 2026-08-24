"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LineaPedido = {
  sku_id: string;
  cantidad: number;
  cantidad_sugerida_sistema: number | null;
  observacion_encargado: string | null;
};

function validarLineasPedido(lineas: LineaPedido[]): string | null {
  if (lineas.length === 0) return "Agregá al menos un producto.";
  for (const l of lineas) {
    if (!l.sku_id) return "Falta seleccionar el SKU en alguna línea.";
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0)
      return "La cantidad tiene que ser un entero mayor a cero.";
  }
  return null;
}

export async function crearPedido(
  lineas: LineaPedido[],
  enviar: boolean,
): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  const errorLineas = validarLineasPedido(lineas);
  if (errorLineas) return { error: errorLineas };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No hay sesión activa." };

  const [{ data: central }, { data: laprida }] = await Promise.all([
    supabase.from("sucursales").select("id").eq("es_central", true).single(),
    supabase.from("sucursales").select("id").eq("es_central", false).single(),
  ]);
  if (!central || !laprida) return { error: "No se encontraron las sucursales." };

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      sucursal_origen_id: central.id,
      sucursal_destino_id: laprida.id,
      usuario_creador_id: user.id,
    })
    .select("id")
    .single();

  if (pedidoError || !pedido) {
    return { error: pedidoError?.message ?? "No se pudo crear el pedido." };
  }

  const { error: itemsError } = await supabase.from("pedido_items").insert(
    lineas.map((l) => ({
      pedido_id: pedido.id,
      sku_id: l.sku_id,
      cantidad_solicitada: l.cantidad,
      cantidad_sugerida_sistema: l.cantidad_sugerida_sistema,
      observacion_encargado: l.observacion_encargado,
    })),
  );

  if (itemsError) return { error: itemsError.message };

  if (enviar) {
    const { error: enviarError } = await supabase
      .from("pedidos")
      .update({ estado: "enviado" })
      .eq("id", pedido.id);
    if (enviarError) return { error: enviarError.message };
  }

  revalidatePath("/pedidos");
  return { id: pedido.id };
}

export async function enviarPedido(pedidoId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("pedidos").update({ estado: "enviado" }).eq("id", pedidoId);
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  return { ok: true };
}

export async function eliminarPedido(pedidoId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("pedidos").delete().eq("id", pedidoId);
  if (error) return { error: error.message };

  revalidatePath("/pedidos");
  return { ok: true };
}

export type LineaAvancePreparacion = { pedido_item_id: string; cantidad: number };

export async function guardarAvancePreparacion(
  pedidoId: string,
  lineas: LineaAvancePreparacion[],
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("guardar_avance_preparacion", {
    p_pedido_id: pedidoId,
    p_lineas: lineas,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  return { ok: true };
}

export async function confirmarPreparacion(
  pedidoId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("confirmar_preparacion", { p_pedido_id: pedidoId });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  return { ok: true };
}

export type LineaDespacho = { pedido_item_id: string; cantidad: number };

export async function despacharPedido(
  pedidoId: string,
  lineas: LineaDespacho[],
  observaciones: string | null,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("despachar_pedido", {
    p_pedido_id: pedidoId,
    p_lineas: lineas,
    p_observaciones: observaciones,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  revalidatePath("/productos");
  return { ok: true };
}

export type LineaRecepcionTransferencia = {
  transferencia_item_id: string;
  cantidad_recibida: number;
  motivo_diferencia: string | null;
};

export async function confirmarRecepcionTransferencia(
  pedidoId: string,
  transferenciaId: string,
  lineas: LineaRecepcionTransferencia[],
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("confirmar_recepcion_transferencia", {
    p_transferencia_id: transferenciaId,
    p_lineas: lineas,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  revalidatePath("/productos");
  return { ok: true };
}

export async function cerrarPedidoManual(
  pedidoId: string,
  motivo: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("cerrar_pedido_manual", {
    p_pedido_id: pedidoId,
    p_motivo: motivo,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  return { ok: true };
}
