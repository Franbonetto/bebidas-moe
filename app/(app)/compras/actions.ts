"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LineaCompra = {
  sku_id: string;
  cantidad: number;
  costo_unitario: number;
};

export type DatosCompra = {
  proveedor_id: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  lineas: LineaCompra[];
  confirmar: boolean;
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

export async function crearCompra(
  datos: DatosCompra,
): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  const errorLineas = validarLineas(datos.lineas);
  if (errorLineas) return { error: errorLineas };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No hay sesión activa." };

  const { data: central } = await supabase
    .from("sucursales")
    .select("id")
    .eq("es_central", true)
    .single();
  if (!central) return { error: "No se encontró la sucursal central." };

  const { data: compra, error: compraError } = await supabase
    .from("compras")
    .insert({
      proveedor_id: datos.proveedor_id,
      sucursal_destino_id: central.id,
      numero_factura: datos.numero_factura,
      fecha_factura: datos.fecha_factura,
      usuario_id: user.id,
    })
    .select("id")
    .single();

  if (compraError || !compra) {
    return { error: compraError?.message ?? "No se pudo crear la compra." };
  }

  const { error: itemsError } = await supabase.from("compra_items").insert(
    datos.lineas.map((l) => ({
      compra_id: compra.id,
      sku_id: l.sku_id,
      cantidad: l.cantidad,
      costo_unitario: l.costo_unitario,
    })),
  );

  if (itemsError) return { error: itemsError.message };

  if (datos.confirmar) {
    const { error: confirmError } = await supabase
      .from("compras")
      .update({ estado: "confirmada" })
      .eq("id", compra.id);
    if (confirmError) return { error: confirmError.message };
  }

  revalidatePath("/compras");
  return { id: compra.id };
}

export async function agregarLineaCompra(
  compraId: string,
  linea: LineaCompra,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const errorLineas = validarLineas([linea]);
  if (errorLineas) return { error: errorLineas };

  const { error } = await supabase.from("compra_items").insert({
    compra_id: compraId,
    sku_id: linea.sku_id,
    cantidad: linea.cantidad,
    costo_unitario: linea.costo_unitario,
  });

  if (error) {
    if (error.code === "23505") return { error: "Ese SKU ya tiene una línea en esta compra." };
    return { error: error.message };
  }

  revalidatePath(`/compras/${compraId}`);
  return { ok: true };
}

export async function actualizarLineaCompra(
  compraId: string,
  itemId: string,
  cantidad: number,
  costoUnitario: number,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const errorLineas = validarLineas([{ sku_id: "x", cantidad, costo_unitario: costoUnitario }]);
  if (errorLineas) return { error: errorLineas };

  const { error } = await supabase
    .from("compra_items")
    .update({ cantidad, costo_unitario: costoUnitario })
    .eq("id", itemId);

  if (error) return { error: error.message };

  revalidatePath(`/compras/${compraId}`);
  return { ok: true };
}

export async function eliminarLineaCompra(
  compraId: string,
  itemId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("compra_items").delete().eq("id", itemId);
  if (error) return { error: error.message };

  revalidatePath(`/compras/${compraId}`);
  return { ok: true };
}

export async function confirmarCompra(
  compraId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("compras")
    .update({ estado: "confirmada" })
    .eq("id", compraId);

  if (error) return { error: error.message };

  revalidatePath(`/compras/${compraId}`);
  revalidatePath("/compras");
  return { ok: true };
}

export async function eliminarCompra(compraId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("compras").delete().eq("id", compraId);
  if (error) return { error: error.message };

  revalidatePath("/compras");
  return { ok: true };
}

export type LineaRecepcion = {
  compra_item_id: string;
  sku_id: string;
  cantidad_recibida: number;
  motivo_diferencia: string | null;
};

export async function crearYConfirmarRecepcion(
  compraId: string,
  lineas: LineaRecepcion[],
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  if (lineas.length === 0) return { error: "No hay líneas pendientes para recibir." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No hay sesión activa." };

  const { data: recepcion, error: recepcionError } = await supabase
    .from("recepciones_compra")
    .insert({ compra_id: compraId, usuario_id: user.id })
    .select("id")
    .single();

  if (recepcionError || !recepcion) {
    return { error: recepcionError?.message ?? "No se pudo crear la recepción." };
  }

  const { error: itemsError } = await supabase.from("recepcion_items").insert(
    lineas.map((l) => ({
      recepcion_id: recepcion.id,
      compra_item_id: l.compra_item_id,
      sku_id: l.sku_id,
      cantidad_recibida: l.cantidad_recibida,
      motivo_diferencia: l.motivo_diferencia,
    })),
  );

  if (itemsError) return { error: itemsError.message };

  const { error: confirmError } = await supabase.rpc("confirmar_recepcion", {
    p_recepcion_id: recepcion.id,
  });

  if (confirmError) return { error: confirmError.message };

  revalidatePath(`/compras/${compraId}`);
  revalidatePath("/productos");
  return { ok: true };
}
