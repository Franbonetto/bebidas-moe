"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guardarPrecioBase } from "@/app/(app)/precios/actions";

export type DatosSkuCarga = {
  stockActual: number;
  costoActual: number | null;
  precioBase: number | null;
  codigoBarras: string | null;
  // Proveedor ya asociado al SKU (proveedor_skus). Si tiene más de uno se
  // toma el primero solo para preseleccionarlo -- el resto no se toca.
  proveedorId: string | null;
  // Vencimiento del último lote cargado, para que se note si ya pasó por
  // este producto.
  vencimientoUltimoLote: string | null;
  // Umbrales de reposición del SKU: se cargan acá porque es el momento en
  // que tiene el producto delante y sabe cuánto le conviene tener.
  stockMinimo: number;
  stockObjetivo: number;
};

// Lo que hay que mostrarle antes de que escriba nada: cuánto tiene el
// sistema hoy (para que se dé cuenta si ya pasó por ese producto), el costo
// y el precio ya cargados.
export async function datosSkuParaCarga(
  skuId: string,
  sucursalId: string,
): Promise<{ error: string } | DatosSkuCarga> {
  const supabase = await createClient();

  const [
    { data: sku, error: errorSku },
    { data: stock },
    { data: precio },
    { data: proveedorSku },
    { data: lote },
  ] = await Promise.all([
    supabase
      .from("skus")
      .select("costo_actual, codigo_barras, stock_minimo, stock_objetivo")
      .eq("id", skuId)
      .maybeSingle(),
    supabase
      .from("stock_sucursal")
      .select("cantidad")
      .eq("sku_id", skuId)
      .eq("sucursal_id", sucursalId)
      .maybeSingle(),
    supabase.from("precios").select("precio_base").eq("sku_id", skuId).maybeSingle(),
    supabase
      .from("proveedor_skus")
      .select("proveedor_id")
      .eq("sku_id", skuId)
      .eq("activo", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("historial_costos")
      .select("fecha_vencimiento")
      .eq("sku_id", skuId)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (errorSku) return { error: errorSku.message };
  if (!sku) return { error: "No encontramos ese producto." };

  return {
    stockActual: stock?.cantidad ?? 0,
    costoActual: sku.costo_actual ?? null,
    precioBase: precio?.precio_base ?? null,
    codigoBarras: sku.codigo_barras ?? null,
    proveedorId: proveedorSku?.proveedor_id ?? null,
    vencimientoUltimoLote: lote?.fecha_vencimiento ?? null,
    stockMinimo: sku.stock_minimo ?? 0,
    stockObjetivo: sku.stock_objetivo ?? 0,
  };
}

// La cantidad es el TOTAL contado en esa sucursal, no un incremento:
// cargar_stock_inicial() registra como ajuste la diferencia contra lo que
// había. Cargar dos veces el mismo producto corrige, no duplica.
export async function guardarCargaInicial(datos: {
  sku_id: string;
  sucursal_id: string;
  cantidad: number;
  costo: number | null;
  precio: number | null;
  // dd/mm/aaaa ya convertido a ISO por el formulario, o null.
  fecha_vencimiento: string | null;
  proveedor_id: string | null;
  // null = no lo tocó, se deja el que ya tenía el SKU.
  stock_minimo: number | null;
  stock_objetivo: number | null;
}): Promise<{ error: string } | { stock: number }> {
  const supabase = await createClient();

  if (!Number.isInteger(datos.cantidad) || datos.cantidad < 0)
    return { error: "La cantidad contada tiene que ser un número entero, cero o más." };
  if (datos.costo !== null && datos.costo < 0) return { error: "El costo no puede ser negativo." };

  for (const [valor, nombre] of [
    [datos.stock_minimo, "El stock mínimo"],
    [datos.stock_objetivo, "El stock objetivo"],
  ] as const) {
    if (valor !== null && (!Number.isInteger(valor) || valor < 0))
      return { error: `${nombre} tiene que ser un número entero, cero o más.` };
  }

  if (
    datos.stock_minimo !== null &&
    datos.stock_objetivo !== null &&
    datos.stock_objetivo > 0 &&
    datos.stock_objetivo < datos.stock_minimo
  )
    return {
      error: "El stock objetivo no puede ser menor que el mínimo: reponer te dejaría bajo el mínimo.",
    };

  // El precio primero: si falla, no queremos stock cargado con el precio a
  // medias. Al revés es peor -- el POS vende sin stock (advierte), pero sin
  // precio no puede vender.
  if (datos.precio !== null) {
    const resultadoPrecio = await guardarPrecioBase(datos.sku_id, datos.precio);
    if ("error" in resultadoPrecio) return { error: resultadoPrecio.error };
  }

  const { data, error } = await supabase.rpc("cargar_stock_inicial", {
    p_sku_id: datos.sku_id,
    p_sucursal_id: datos.sucursal_id,
    p_cantidad: datos.cantidad,
    p_costo: datos.costo,
    p_fecha_vencimiento: datos.fecha_vencimiento,
    p_proveedor_id: datos.proveedor_id,
  });

  if (error) return { error: error.message };

  // Los umbrales viven en el catálogo (skus), no en el stock: van aparte, con
  // el update directo que ya usa el resto del catálogo (RLS ve_costos()).
  if (datos.stock_minimo !== null || datos.stock_objetivo !== null) {
    const cambios: { stock_minimo?: number; stock_objetivo?: number } = {};
    if (datos.stock_minimo !== null) cambios.stock_minimo = datos.stock_minimo;
    if (datos.stock_objetivo !== null) cambios.stock_objetivo = datos.stock_objetivo;

    const { error: errorUmbrales } = await supabase
      .from("skus")
      .update(cambios)
      .eq("id", datos.sku_id);

    if (errorUmbrales)
      return {
        error: `El stock quedó cargado, pero no se pudieron guardar los mínimos: ${errorUmbrales.message}`,
      };
  }

  revalidatePath("/productos");
  revalidatePath("/carga-inicial");
  return { stock: (data as number) ?? datos.cantidad };
}
