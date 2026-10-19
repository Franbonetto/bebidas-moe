"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { facturarVentaAutomatica } from "./facturar/actions";

export type LineaVenta = {
  // null en un producto particular, que va con descripcion en su lugar
  // (ver 20261009090000_producto_particular.sql).
  sku_id: string | null;
  descripcion?: string | null;
  cantidad: number;
  precio_unitario: number;
  precio_lista_unitario: number;
  promocion_id: string | null;
  con_envase: boolean;
  // Recargo por frio y precio editado a mano (2026-10-17, ver
  // 20261017090000_precio_manual_y_recargo_frio.sql). Los dos son el RASTRO
  // de como se llego al precio: `precio_unitario` ya viene con el recargo
  // adentro y con el precio tipeado, no se vuelven a sumar del lado de la
  // base.
  //
  //   recargo_frio    cuanto de precio_unitario es recargo, por unidad
  //   precio_catalogo que precio tenia el SKU antes de que lo tocaran
  recargo_frio?: number;
  precio_editado?: boolean;
  precio_catalogo?: number | null;
};

export type ComprobanteResumen = {
  tipoCbte: "A" | "B";
  numeroComprobante: number;
  cae: string;
  vencimientoCae: string;
};

export type PagoVenta = {
  medio_pago: "efectivo" | "debito" | "credito" | "transferencia" | "qr";
  monto: number;
};

export type DatosEnvio = {
  motomandado: string;
  direccionEnvio: string;
};

// Pago dividido (hasta 3 medios): ver 20260919100000_venta_pagos.sql.
// Los montos tienen que sumar exacto el total de la venta -- el RPC lo
// valida de nuevo server-side, esto no reemplaza esa validación.
//
// `envio` es opcional (ver 20260921100000_envios.sql): el POS normal nunca
// lo manda, así que confirmar_venta() recibe es_envio=false/motomandado y
// direccion en null por default -- una venta de mostrador no cambia nada.
export async function confirmarVenta(
  sucursalId: string,
  pagos: PagoVenta[],
  lineas: LineaVenta[],
  envio?: DatosEnvio,
): Promise<
  | { error: string }
  | { id: string; comprobante: ComprobanteResumen | null; avisoFacturacion: string | null }
> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("confirmar_venta", {
    p_sucursal_id: sucursalId,
    p_pagos: pagos,
    p_lineas: lineas,
    p_es_envio: Boolean(envio),
    p_motomandado: envio?.motomandado ?? null,
    p_direccion_envio: envio?.direccionEnvio ?? null,
  });

  if (error) return { error: error.message };

  const ventaId = (data as { id: string }).id;

  // Facturación automática de lo que no es efectivo (decisión del usuario
  // 2026-10-19, reemplaza el "no se factura sola" del 2026-10-08): débito,
  // crédito, transferencia y QR se facturan acá mismo, como Factura B a
  // Consumidor Final. El efectivo no.
  //
  // El orden importa y es a propósito: la venta YA está grabada por
  // confirmar_venta() antes de que se hable con ARCA. Si ARCA rechaza,
  // tarda o está caído, la venta sigue existiendo igual y el comprobante
  // queda reintentable desde /vender/facturar -- la facturación nunca
  // voltea una venta (docs/bloque_arca_facturacion.md, sección 4).
  //
  // El POS espera este resultado (hasta ~15s de tope, ver el timeout de
  // lib/arca/wsfe.ts) porque el ticket que imprime la cajera tiene que
  // salir ya con el CAE y el QR: el cliente se lleva la factura en el
  // mismo papel, no vuelve al otro día a buscarla.
  const facturacion = await facturarVentaAutomatica(ventaId);
  const comprobante: ComprobanteResumen | null = facturacion.facturado
    ? facturacion.comprobante
    : null;
  const avisoFacturacion = facturacion.facturado ? null : facturacion.aviso;

  revalidatePath("/vender");
  revalidatePath("/envios");
  return { id: ventaId, comprobante, avisoFacturacion };
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

// El empleado es obligatorio (decisión del usuario 2026-10-06): la cuenta
// con la que se entra al sistema son tres, pero el mostrador lo atienden
// varias personas. Sin esto, una diferencia de caja no se le puede atribuir
// a nadie. Mismo criterio que la merma.
export async function abrirCaja(
  sucursalId: string,
  montoApertura: number,
  empleadoId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("abrir_caja", {
    p_sucursal_id: sucursalId,
    p_monto_apertura: montoApertura,
    p_empleado_id: empleadoId,
  });

  if (error) return { error: error.message };

  revalidatePath("/vender");
  revalidatePath("/vender/caja");
  return { ok: true };
}

// Puede ser una persona distinta de la que abrió: el turno cambia de manos.
export async function cerrarCaja(
  cajaId: string,
  efectivoDeclarado: number,
  empleadoId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("cerrar_caja", {
    p_caja_id: cajaId,
    p_efectivo_declarado: efectivoDeclarado,
    p_empleado_id: empleadoId,
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
