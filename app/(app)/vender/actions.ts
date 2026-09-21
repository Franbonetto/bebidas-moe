"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { facturarVentaAutomatico } from "./facturar/actions";

export type LineaVenta = {
  sku_id: string;
  cantidad: number;
  precio_unitario: number;
  precio_lista_unitario: number;
  promocion_id: string | null;
  con_envase: boolean;
};

export type ComprobanteResumen = {
  tipoCbte: "A" | "B";
  numeroComprobante: number;
  cae: string;
  vencimientoCae: string;
};

export type PagoVenta = {
  medio_pago: "efectivo" | "debito" | "credito" | "transferencia";
  monto: number;
};

// Pago dividido (hasta 3 medios): ver 20260919100000_venta_pagos.sql.
// Los montos tienen que sumar exacto el total de la venta -- el RPC lo
// valida de nuevo server-side, esto no reemplaza esa validación.
export async function confirmarVenta(
  sucursalId: string,
  pagos: PagoVenta[],
  lineas: LineaVenta[],
): Promise<{ error: string } | { id: string; comprobante: ComprobanteResumen | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("confirmar_venta", {
    p_sucursal_id: sucursalId,
    p_pagos: pagos,
    p_lineas: lineas,
  });

  if (error) return { error: error.message };

  const ventaId = (data as { id: string }).id;

  // Facturación automática para cualquier sucursal que tenga un punto de
  // venta ARCA activo configurado (antes: solo Olavarría, hardcodeado).
  // Si falla (ARCA caído, rechazo, etc.) no se propaga como error acá --
  // la venta ya está confirmada y cobrada; queda para reintentar desde
  // /vender/facturar, mismo criterio que un rechazo manual cualquiera.
  const { data: puntoVenta } = await supabase
    .from("puntos_venta")
    .select("id")
    .eq("sucursal_id", sucursalId)
    .eq("activo", true)
    .maybeSingle();
  let comprobante: ComprobanteResumen | null = null;

  if (puntoVenta) {
    await facturarVentaAutomatico(ventaId).catch(() => {});

    const { data: comprobanteRow } = await supabase
      .from("comprobantes_fiscales")
      .select("tipo_cbte, numero_comprobante, cae, vencimiento_cae, estado")
      .eq("venta_id", ventaId)
      .maybeSingle();

    if (comprobanteRow?.estado === "autorizado" && comprobanteRow.cae && comprobanteRow.numero_comprobante) {
      comprobante = {
        tipoCbte: comprobanteRow.tipo_cbte as "A" | "B",
        numeroComprobante: comprobanteRow.numero_comprobante,
        cae: comprobanteRow.cae,
        vencimientoCae: comprobanteRow.vencimiento_cae ?? "",
      };
    }
  }

  revalidatePath("/vender");
  return { id: ventaId, comprobante };
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

export type DevolucionItemInput = {
  ventaItemId: string;
  cantidad: number;
  destino: "stock" | "merma";
};

export type CambioItemInput = {
  skuId: string;
  cantidad: number;
};

export async function confirmarDevolucion(input: {
  ventaId: string;
  items: DevolucionItemInput[];
  resolucion: "dinero" | "cambio";
  cambioItems: CambioItemInput[];
  observaciones: string | null;
}): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("confirmar_devolucion", {
    p_venta_id: input.ventaId,
    p_items: input.items.map((i) => ({
      venta_item_id: i.ventaItemId,
      cantidad: i.cantidad,
      destino: i.destino,
    })),
    p_resolucion: input.resolucion,
    p_cambio_items:
      input.resolucion === "cambio"
        ? input.cambioItems.map((c) => ({ sku_id: c.skuId, cantidad: c.cantidad }))
        : null,
    p_observaciones: input.observaciones,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender");
  revalidatePath("/vender/caja");
  revalidatePath("/vender/devoluciones");
  return { id: (data as { id: string }).id };
}

export async function abrirCaja(
  sucursalId: string,
  montoApertura: number,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("abrir_caja", {
    p_sucursal_id: sucursalId,
    p_monto_apertura: montoApertura,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender");
  revalidatePath("/vender/caja");
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

// Entrada/salida de efectivo que no es una venta (ej. retirar plata,
// poner fondo extra a mitad de turno) -- ver
// 20260919090000_movimientos_caja.sql. Se puede disparar tanto desde el
// POS (atajo rápido F7/F8) como desde /vender/caja.
export async function registrarMovimientoCaja(
  cajaId: string,
  tipo: "entrada" | "salida",
  monto: number,
  motivo: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("registrar_movimiento_caja", {
    p_caja_id: cajaId,
    p_tipo: tipo,
    p_monto: monto,
    p_motivo: motivo,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender");
  revalidatePath("/vender/caja");
  return { ok: true };
}
