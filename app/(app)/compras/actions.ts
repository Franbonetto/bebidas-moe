"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TipoComprobante } from "./_lib/comprobante";

export type LineaCompra = {
  sku_id: string;
  cantidad: number;
  costo_unitario: number;
  // Opcional: no todos los productos vencen (ej. vinos), otros sí (ej.
  // gaseosa) -- se carga si corresponde, nunca es obligatorio.
  fecha_vencimiento: string | null;
};

// Dato fiscal del comprobante, tal como figura en el papel. Vive en el
// encabezado de la compra, no en las líneas: el costo por línea sigue
// siendo el precio final pagado (IVA incluido), que es lo que usan el
// margen y la cascada de precios.
export type ComprobanteCompra = {
  tipo_comprobante: TipoComprobante;
  numero_factura: string | null;
  fecha_factura: string | null;
  // El pie de la factura, tal cual figura en el papel. Solo Factura A: es la
  // única que discrimina.
  neto_gravado: number | null;
  iva: number | null;
  // Bebidas con alcohol: en una factura de licor pueden ser el 17% del
  // comprobante. El IVA se calcula sobre el neto gravado, no sobre neto +
  // internos.
  impuestos_internos: number | null;
  // Pago a cuenta del propio IVA: se descuenta de lo que hay que depositar.
  percepcion_iva: number | null;
  // Va a Ingresos Brutos, no toca el IVA. Se guarda para que el pie cuadre.
  percepcion_iibb: number | null;
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

// Mismo criterio que validar_comprobante_fiscal_compra() en la base: acá es
// para dar el mensaje antes de ir al servidor, la validación real vive en
// Postgres (la app no es la última palabra sobre qué es un comprobante
// válido).
function validarComprobante(c: ComprobanteCompra): string | null {
  if (!c.tipo_comprobante) return "Indicá con qué vino la mercadería: Factura A, Factura B o remito.";

  if (c.tipo_comprobante === "factura_a" || c.tipo_comprobante === "factura_b") {
    if (!c.numero_factura) return "Cargá el número de la factura.";
    if (!c.fecha_factura) return "Cargá la fecha de la factura.";
  }

  if (c.tipo_comprobante === "factura_a") {
    if (c.neto_gravado === null || c.iva === null)
      return "La Factura A tiene el IVA discriminado: cargá el neto gravado y el IVA.";
    if (c.neto_gravado <= 0) return "El neto gravado tiene que ser mayor a cero.";
    if (c.iva < 0) return "El IVA no puede ser negativo.";
  }

  for (const [valor, nombre] of [
    [c.impuestos_internos, "Los impuestos internos"],
    [c.percepcion_iva, "La percepción de IVA"],
    [c.percepcion_iibb, "La percepción de IIBB"],
  ] as const) {
    if (valor !== null && valor < 0) return `${nombre} no puede ser un monto negativo.`;
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
  comprobante: ComprobanteCompra;
  lineas: LineaCompra[];
}): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  if (!datos.proveedor_id) return { error: "Elegí un proveedor." };

  const errorComprobante = validarComprobante(datos.comprobante);
  if (errorComprobante) return { error: errorComprobante };

  const errorLineas = validarLineas(datos.lineas);
  if (errorLineas) return { error: errorLineas };

  const { data, error } = await supabase.rpc("cargar_compra_directa", {
    p_proveedor_id: datos.proveedor_id,
    p_numero_factura: datos.comprobante.numero_factura,
    p_fecha_factura: datos.comprobante.fecha_factura,
    p_lineas: datos.lineas,
    p_tipo_comprobante: datos.comprobante.tipo_comprobante,
    p_neto_gravado: datos.comprobante.neto_gravado,
    p_iva: datos.comprobante.iva,
    p_impuestos_internos: datos.comprobante.impuestos_internos,
    p_percepcion_iva: datos.comprobante.percepcion_iva,
    p_percepcion_iibb: datos.comprobante.percepcion_iibb,
  });

  if (error) return { error: error.message };

  revalidatePath("/compras");
  revalidatePath("/productos");
  revalidatePath("/reportes/iva");
  return { id: data as string };
}

// La mercadería llegó con remito y la factura llegó después (o se cargó mal
// el tipo). Cambia SOLO el comprobante fiscal -- no toca stock, costos ni el
// total -- y deja una fila inmutable en compras_reclasificacion_fiscal con
// quién, cuándo y por qué.
export async function reclasificarComprobanteCompra(datos: {
  compra_id: string;
  comprobante: ComprobanteCompra;
  motivo: string;
}): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const errorComprobante = validarComprobante(datos.comprobante);
  if (errorComprobante) return { error: errorComprobante };

  if (!datos.motivo.trim())
    return { error: "Escribí por qué se cambia el comprobante de esta compra." };

  const { error } = await supabase.rpc("reclasificar_comprobante_compra", {
    p_compra_id: datos.compra_id,
    p_tipo_comprobante: datos.comprobante.tipo_comprobante,
    p_numero_factura: datos.comprobante.numero_factura,
    p_fecha_factura: datos.comprobante.fecha_factura,
    p_motivo: datos.motivo.trim(),
    p_neto_gravado: datos.comprobante.neto_gravado,
    p_iva: datos.comprobante.iva,
    p_impuestos_internos: datos.comprobante.impuestos_internos,
    p_percepcion_iva: datos.comprobante.percepcion_iva,
    p_percepcion_iibb: datos.comprobante.percepcion_iibb,
  });

  if (error) return { error: error.message };

  revalidatePath("/compras");
  revalidatePath(`/compras/${datos.compra_id}`);
  revalidatePath("/reportes/iva");
  return { ok: true };
}
