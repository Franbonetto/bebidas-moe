"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MOTIVOS_MERMA, type MotivoMerma } from "./_lib/motivos";

// Stock y vencimiento del último lote: a diferencia de la carga inicial, acá
// no se lee costo ni precio -- esta pantalla la usa también el encargado de
// Laprida, que no ve costos.
//
// El vencimiento se trae para precargarlo cuando el motivo es "vencido": el
// sistema ya sabe qué decía el último lote, así que no tiene sentido hacer
// que lo tipeen de nuevo (igual se puede corregir, porque en la góndola
// puede haber mercadería de un lote anterior).
export async function datosSkuParaMerma(
  skuId: string,
  sucursalId: string,
): Promise<{ error: string } | { stock: number; vencimientoUltimoLote: string | null }> {
  const supabase = await createClient();

  const [{ data: stock, error }, { data: lote }] = await Promise.all([
    supabase
      .from("stock_sucursal")
      .select("cantidad")
      .eq("sku_id", skuId)
      .eq("sucursal_id", sucursalId)
      .maybeSingle(),
    supabase
      .from("historial_costos")
      .select("fecha_vencimiento")
      .eq("sku_id", skuId)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (error) return { error: error.message };
  return {
    stock: stock?.cantidad ?? 0,
    vencimientoUltimoLote: lote?.fecha_vencimiento ?? null,
  };
}

export type ItemMerma = {
  sku_id: string;
  // Solo para el mensaje de error: que diga de qué producto está hablando en
  // vez de "el ítem 3".
  nombre: string;
  cantidad: number;
  motivo: MotivoMerma;
  detalle: string | null;
  // Solo cuando el motivo es "vencido": cuándo vencía lo que se tira.
  fecha_vencimiento: string | null;
};

// Varios productos en una sola carga (pedido del usuario 2026-10-26): cuando
// se rompe una caja se pierden tres cosas distintas, y volver a entrar a la
// pantalla por cada una hacía que directamente no se anotaran.
//
// Cada merma sigue siendo un documento propio con su movimiento (una rotura y
// un vencido son eventos independientes, no renglones de un mismo papel), así
// que no hay una función nueva en la base: se llama registrar_merma() una vez
// por producto.
//
// Dos cuidados por eso mismo:
//  - se valida TODA la lista antes de escribir nada, para que un motivo que
//    falta en el último producto no deje media carga hecha;
//  - las llamadas van en orden y de a una (no Promise.all): así "fallaron
//    desde la N" es una respuesta precisa y la pantalla puede dejar en la
//    lista justo lo que no entró, y además dos renglones del mismo SKU no se
//    pelean por la misma fila de stock.
export async function registrarMermas(datos: {
  sucursal_id: string;
  // Quién la registra: en el mostrador comparten la sesión del encargado,
  // así que el usuario logueado no alcanza para saber de quién fue. Va en el
  // encabezado porque la carga la hace una persona, aunque la tabla lo
  // guarde por merma.
  empleado_id: string;
  items: ItemMerma[];
}): Promise<{ ok: true; registradas: number } | { error: string; registradas: number }> {
  const supabase = await createClient();

  if (datos.items.length === 0) return { error: "Agregá al menos un producto.", registradas: 0 };

  if (!datos.empleado_id) return { error: "Elegí quién la registra.", registradas: 0 };

  for (const item of datos.items) {
    const nombre = item.nombre || "el producto";

    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0)
      return {
        error: `${nombre}: la cantidad tiene que ser un número entero mayor a cero.`,
        registradas: 0,
      };

    if (!MOTIVOS_MERMA.includes(item.motivo))
      return { error: `${nombre}: elegí un motivo.`, registradas: 0 };

    if (item.motivo === "otro" && !item.detalle?.trim())
      return { error: `${nombre}: si el motivo es "otro", explicá qué pasó.`, registradas: 0 };

    if (item.motivo === "vencido" && !item.fecha_vencimiento)
      return { error: `${nombre}: indicá cuándo vencía.`, registradas: 0 };
  }

  let registradas = 0;

  for (const item of datos.items) {
    const { error } = await supabase.rpc("registrar_merma", {
      p_sku_id: item.sku_id,
      p_sucursal_id: datos.sucursal_id,
      p_cantidad: item.cantidad,
      p_motivo: item.motivo,
      p_empleado_id: datos.empleado_id,
      p_detalle: item.detalle?.trim() || null,
      p_fecha_vencimiento: item.motivo === "vencido" ? item.fecha_vencimiento : null,
    });

    if (error) {
      revalidatePath("/mermas");
      revalidatePath("/productos");
      return {
        error:
          registradas === 0
            ? error.message
            : `Se registraron ${registradas} de ${datos.items.length}. ` +
              `${item.nombre || "Un producto"} falló: ${error.message}`,
        registradas,
      };
    }

    registradas += 1;
  }

  revalidatePath("/mermas");
  revalidatePath("/productos");
  return { ok: true, registradas };
}
