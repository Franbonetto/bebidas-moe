"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { verificarPinOperaciones } from "@/lib/pin";

type Resultado = { error: string } | { ok: true };

function validarMonto(valor: number, etiqueta: string): string | null {
  if (typeof valor !== "number" || Number.isNaN(valor) || valor < 0) {
    return `${etiqueta} tiene que ser un número mayor o igual a cero.`;
  }
  return null;
}

export async function guardarPrecioBase(skuId: string, precioBase: number, pin: string): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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

export async function eliminarOverride(sucursalId: string, skuId: string, pin: string): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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

// Precio en efectivo de un SKU: monto fijo, no un porcentaje
// (20261014090000_precio_efectivo_sku.sql). Le gana al descuento de la
// categoría, así que cargarlo saca a ese SKU del 10% de Vinos y lo deja en
// el número que se escribió acá.
export async function guardarPrecioEfectivo(
  sucursalId: string,
  skuId: string,
  precioEfectivo: number,
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const supabase = await createClient();

  const errorMonto = validarMonto(precioEfectivo, "El precio en efectivo");
  if (errorMonto) return { error: errorMonto };

  const { error } = await supabase
    .from("precios_efectivo")
    .upsert(
      { sucursal_id: sucursalId, sku_id: skuId, precio_efectivo: precioEfectivo },
      { onConflict: "sucursal_id,sku_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/precios");
  revalidatePath("/vender");
  return { ok: true };
}

// Borrarlo devuelve al SKU al comportamiento de siempre: el descuento por
// efectivo de su categoría, si tiene uno.
export async function eliminarPrecioEfectivo(
  sucursalId: string,
  skuId: string,
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const supabase = await createClient();

  const { error } = await supabase
    .from("precios_efectivo")
    .delete()
    .eq("sucursal_id", sucursalId)
    .eq("sku_id", skuId);

  if (error) return { error: error.message };

  revalidatePath("/precios");
  revalidatePath("/vender");
  return { ok: true };
}

export async function guardarRecargoCategoria(
  sucursalId: string,
  categoriaId: string,
  montoFijo: number,
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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

export async function eliminarRecargoSku(sucursalId: string, skuId: string, pin: string): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
  // El total que paga el cliente, por sucursal. Una promo que corre en las
  // dos lleva dos filas, porque Olavarría y Laprida no manejan los mismos
  // precios (pedido del usuario 2026-10-08).
  precios: { sucursalId: string; precioTotal: number }[];
};

// Una promocion son dos escrituras (promociones + promocion_items). Se
// agrupan en la funcion guardar_promocion() (SECURITY DEFINER) para que
// queden en una sola transaccion -- ver el comentario de la migracion
// 20260903090000_bloque_promociones_admin.sql.
export async function guardarPromocion(input: GuardarPromocionInput, pin: string): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
    })),
    p_precios: input.precios.map((p) => ({
      sucursal_id: p.sucursalId,
      precio_total: p.precioTotal,
    })),
  });

  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function activarPromocion(id: string, activo: boolean, pin: string): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const supabase = await createClient();

  const { error } = await supabase.from("promociones").update({ activo }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

export async function eliminarPromocion(id: string, pin: string): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const supabase = await createClient();

  const { error } = await supabase.from("promociones").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/precios");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Promo por cantidad de un SKU puntual (2x, 3x), para poder cargarla desde
// carga inicial sin pasar por el formulario completo de /precios.
//
// No agrega nada al modelo: es la misma promoción tipo 'cantidad' del
// bloque 6, guardada con la misma guardar_promocion(). Lo único propio de
// acá es encontrar la promo que ya existe para ese SKU, para editarla en vez
// de dejar dos promos compitiendo por el mismo producto.
// ---------------------------------------------------------------------------

export type PromoCantidadSku = {
  id: string;
  nombre: string;
  cantidadRequerida: number;
  // Total de la promo en la sucursal consultada. null = la promo existe
  // pero no corre acá (no tiene precio cargado para esta sucursal).
  precioTotal: number | null;
  activo: boolean;
};

type PromoFila = {
  id: string;
  nombre: string;
  activo: boolean;
  sucursal_id: string | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  promocion_items: { sku_id: string; cantidad_requerida: number }[];
  promocion_precios: { sucursal_id: string; precio_total: number }[];
};

const SELECT_PROMO_CANTIDAD = `id, nombre, activo, sucursal_id, vigente_desde, vigente_hasta,
   promocion_items ( sku_id, cantidad_requerida ),
   promocion_precios ( sucursal_id, precio_total )`;

// Las promos por cantidad de un SKU. Devuelve varias solo si de verdad hay
// más de una (ej. un 2x y un 3x cargados desde /precios): en ese caso carga
// inicial no las toca, porque elegir una por su cuenta sería adivinar.
async function promosCantidadDelSku(
  supabase: Awaited<ReturnType<typeof createClient>>,
  skuId: string,
): Promise<{ error: string } | { promos: PromoFila[] }> {
  const { data, error } = await traerTodo(
    supabase.from("promociones").select(SELECT_PROMO_CANTIDAD).eq("tipo", "cantidad"),
  );

  if (error) return { error: error.message };

  const promos = ((data ?? []) as unknown as PromoFila[]).filter(
    (p) => p.promocion_items.length === 1 && p.promocion_items[0]?.sku_id === skuId,
  );

  return { promos };
}

export async function promoCantidadDeSku(
  skuId: string,
  sucursalId: string,
): Promise<{ error: string } | { promo: PromoCantidadSku | null; varias: boolean }> {
  const supabase = await createClient();

  const resultado = await promosCantidadDelSku(supabase, skuId);
  if ("error" in resultado) return resultado;

  const { promos } = resultado;
  if (promos.length === 0) return { promo: null, varias: false };

  const p = promos[0];
  const fila = p.promocion_precios.find((f) => f.sucursal_id === sucursalId);

  return {
    promo: {
      id: p.id,
      nombre: p.nombre,
      cantidadRequerida: p.promocion_items[0].cantidad_requerida,
      precioTotal: fila ? Number(fila.precio_total) : null,
      activo: p.activo,
    },
    varias: promos.length > 1,
  };
}

export async function guardarPromoCantidadSku(input: {
  skuId: string;
  sucursalId: string;
  cantidadRequerida: number;
  // null = este producto deja de tener promo por cantidad en esta sucursal.
  precioTotal: number | null;
  // Solo se usa al crearla; si la promo ya existe se respeta el nombre que
  // tiene, que es el que sale impreso en el ticket.
  nombreSugerido: string;
},
  pin: string,
): Promise<Resultado> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const supabase = await createClient();

  const resultado = await promosCantidadDelSku(supabase, input.skuId);
  if ("error" in resultado) return resultado;

  const { promos } = resultado;
  if (promos.length > 1) {
    return {
      error:
        "Este producto tiene más de una promo por cantidad cargada. Editalas desde Precios → Promociones para no dejar dos compitiendo.",
    };
  }

  const existente = promos[0] ?? null;

  // Sacarla de esta sucursal: se borra su precio de acá y la promo deja de
  // correr en esta sucursal (el POS solo aplica las que tienen precio
  // cargado). No se borra la promoción: si corre en la otra sucursal tiene
  // que seguir corriendo ahí.
  if (input.precioTotal === null) {
    if (!existente) return { ok: true };

    const { error } = await supabase
      .from("promocion_precios")
      .delete()
      .eq("promocion_id", existente.id)
      .eq("sucursal_id", input.sucursalId);

    if (error) return { error: error.message };

    const quedanOtras = existente.promocion_precios.some(
      (f) => f.sucursal_id !== input.sucursalId,
    );

    // Sin precio en ninguna sucursal la promo no corre en ningún lado: se
    // desactiva para que no quede figurando como activa en /precios. No se
    // borra, así se puede volver a usar.
    if (!quedanOtras) {
      const { error: errorActivo } = await supabase
        .from("promociones")
        .update({ activo: false })
        .eq("id", existente.id);

      if (errorActivo) return { error: errorActivo.message };
    }

    revalidatePath("/precios");
    revalidatePath("/vender");
    return { ok: true };
  }

  if (!Number.isInteger(input.cantidadRequerida) || input.cantidadRequerida < 2) {
    return { error: "La promo por cantidad arranca en 2 unidades (2x, 3x...)." };
  }

  const errorMonto = validarMonto(input.precioTotal, "El total de la promo");
  if (errorMonto) return { error: errorMonto };

  // Una promo acotada a la otra sucursal no se puede tocar desde acá: habría
  // que cambiarle el alcance, y eso es una decisión que se toma viendo la
  // promo completa.
  if (existente?.sucursal_id != null && existente.sucursal_id !== input.sucursalId) {
    return {
      error:
        "La promo de este producto está cargada solo para la otra sucursal. Editala desde Precios → Promociones.",
    };
  }

  // guardar_promocion() reemplaza TODOS los precios de la promo por los que
  // le mandes, así que los de las otras sucursales viajan de nuevo tal como
  // están: si no, cargar el 2x de Olavarría borraría el de Laprida.
  const precios = [
    ...existente?.promocion_precios
      .filter((f) => f.sucursal_id !== input.sucursalId)
      .map((f) => ({ sucursalId: f.sucursal_id, precioTotal: Number(f.precio_total) })) ?? [],
    { sucursalId: input.sucursalId, precioTotal: input.precioTotal },
  ];

  return guardarPromocion(
    {
      id: existente?.id ?? null,
      nombre: existente?.nombre ?? input.nombreSugerido,
      tipo: "cantidad",
      // null = corre donde tenga precio cargado. Es lo que permite cargar el
      // 2x de una sucursal sin decidir nada sobre la otra.
      sucursalId: existente?.sucursal_id ?? null,
      vigenteDesde: existente?.vigente_desde ?? null,
      vigenteHasta: existente?.vigente_hasta ?? null,
      // Cargar un precio reactiva la promo: es lo que se espera al escribir el
      // número de nuevo sobre una promo que estaba apagada.
      activo: true,
      items: [{ skuId: input.skuId, cantidadRequerida: input.cantidadRequerida }],
      precios,
    },
    // El PIN ya se validó al entrar a esta función; se reenvía porque
    // guardarPromocion() lo vuelve a validar por su cuenta.
    pin,
  );
}
