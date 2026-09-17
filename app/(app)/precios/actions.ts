"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Resultado = { error: string } | { ok: true };

function validarMonto(valor: number, etiqueta: string): string | null {
  if (typeof valor !== "number" || Number.isNaN(valor) || valor < 0) {
    return `${etiqueta} tiene que ser un número mayor o igual a cero.`;
  }
  return null;
}

export async function guardarPrecioBase(skuId: string, precioBase: number): Promise<Resultado> {
  const supabase = await createClient();

  const errorMonto = validarMonto(precioBase, "El precio base");
  if (errorMonto) return { error: errorMonto };

  const { error } = await supabase
    .from("precios")
    .upsert({ sku_id: skuId, precio_base: precioBase }, { onConflict: "sku_id" });

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function guardarOverride(
  sucursalId: string,
  skuId: string,
  precioOverride: number,
): Promise<Resultado> {
  const supabase = await createClient();

  const errorMonto = validarMonto(precioOverride, "El precio de excepción");
  if (errorMonto) return { error: errorMonto };

  const { error } = await supabase
    .from("precios_sucursal")
    .upsert(
      { sucursal_id: sucursalId, sku_id: skuId, precio_override: precioOverride },
      { onConflict: "sucursal_id,sku_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function eliminarOverride(sucursalId: string, skuId: string): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("precios_sucursal")
    .delete()
    .eq("sucursal_id", sucursalId)
    .eq("sku_id", skuId);

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function marcarCascadaCerveza(skuId: string, valor: boolean): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase.from("skus").update({ cascada_cerveza_lata: valor }).eq("id", skuId);
  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function guardarRecargoCategoria(
  sucursalId: string,
  categoriaId: string,
  montoFijo: number,
): Promise<Resultado> {
  const supabase = await createClient();

  const errorMonto = validarMonto(montoFijo, "El recargo");
  if (errorMonto) return { error: errorMonto };

  const { error } = await supabase
    .from("recargos_sucursal")
    .upsert(
      { sucursal_id: sucursalId, categoria_id: categoriaId, monto_fijo: montoFijo },
      { onConflict: "sucursal_id,categoria_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function eliminarRecargoCategoria(
  sucursalId: string,
  categoriaId: string,
): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("recargos_sucursal")
    .delete()
    .eq("sucursal_id", sucursalId)
    .eq("categoria_id", categoriaId);

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function guardarRecargoSku(
  sucursalId: string,
  skuId: string,
  montoFijo: number,
): Promise<Resultado> {
  const supabase = await createClient();

  const errorMonto = validarMonto(montoFijo, "El recargo");
  if (errorMonto) return { error: errorMonto };

  const { error } = await supabase
    .from("recargos_sku")
    .upsert(
      { sucursal_id: sucursalId, sku_id: skuId, monto_fijo: montoFijo },
      { onConflict: "sucursal_id,sku_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function eliminarRecargoSku(sucursalId: string, skuId: string): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("recargos_sku")
    .delete()
    .eq("sucursal_id", sucursalId)
    .eq("sku_id", skuId);

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function guardarDescuentoEfectivo(
  sucursalId: string,
  categoriaId: string,
  porcentaje: number,
): Promise<Resultado> {
  const supabase = await createClient();

  if (typeof porcentaje !== "number" || Number.isNaN(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
    return { error: "El porcentaje tiene que estar entre 0 y 100." };
  }

  const { error } = await supabase
    .from("descuentos_efectivo")
    .upsert(
      { sucursal_id: sucursalId, categoria_id: categoriaId, porcentaje },
      { onConflict: "sucursal_id,categoria_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function eliminarDescuentoEfectivo(
  sucursalId: string,
  categoriaId: string,
): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("descuentos_efectivo")
    .delete()
    .eq("sucursal_id", sucursalId)
    .eq("categoria_id", categoriaId);

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export type PromocionItemInput = {
  skuId: string;
  cantidadRequerida: number;
  precioPromocional: number;
};

export type GuardarPromocionInput = {
  id: string | null;
  nombre: string;
  tipo: "combo" | "cantidad";
  sucursalId: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  activo: boolean;
  items: PromocionItemInput[];
};

// Una promocion son dos escrituras (promociones + promocion_items). Se
// agrupan en la funcion guardar_promocion() (SECURITY DEFINER) para que
// queden en una sola transaccion -- ver el comentario de la migracion
// 20260903090000_bloque_promociones_admin.sql.
export async function guardarPromocion(input: GuardarPromocionInput): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("guardar_promocion", {
    p_id: input.id,
    p_nombre: input.nombre,
    p_tipo: input.tipo,
    p_sucursal_id: input.sucursalId,
    p_vigente_desde: input.vigenteDesde,
    p_vigente_hasta: input.vigenteHasta,
    p_activo: input.activo,
    p_items: input.items.map((i) => ({
      sku_id: i.skuId,
      cantidad_requerida: i.cantidadRequerida,
      precio_promocional: i.precioPromocional,
    })),
  });

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function activarPromocion(id: string, activo: boolean): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase.from("promociones").update({ activo }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function eliminarPromocion(id: string): Promise<Resultado> {
  const supabase = await createClient();

  const { error } = await supabase.from("promociones").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}
