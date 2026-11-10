"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { calcularPrecioVenta } from "@/lib/precios";
import { fechaOperativa } from "@/lib/fecha";
import type { PrecioParaCartel } from "@/lib/avisos-precio-laprida";

type PromoFila = {
  id: string;
  nombre: string;
  activo: boolean;
  sucursal_id: string | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  promocion_precios: { sucursal_id: string; precio_total: number }[];
  promocion_items: {
    cantidad_requerida: number;
    sku: { nombre: string; producto: { nombre: string } | { nombre: string }[] | null } | null;
  }[];
};

const SELECT_PROMO = `id, nombre, activo, sucursal_id, vigente_desde, vigente_hasta,
  promocion_precios ( sucursal_id, precio_total ),
  promocion_items ( cantidad_requerida, sku:skus ( nombre, producto:productos ( nombre ) ) )`;

function unaFila<T>(rel: T | T[] | null | undefined): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) ?? null;
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function armarPromo(p: PromoFila, lapridaId: string, hoy: string): PrecioParaCartel["promociones"][number] {
  const detalle = (p.promocion_items ?? [])
    .map((it) => {
      const nombre = unaFila(it.sku?.producto)?.nombre ?? it.sku?.nombre ?? "producto";
      return `${it.cantidad_requerida} × ${nombre}`;
    })
    .join(" + ");
  const total = (p.promocion_precios ?? []).find((f) => f.sucursal_id === lapridaId)?.precio_total ?? null;
  const vigente =
    p.activo &&
    (p.vigente_desde == null || p.vigente_desde <= hoy) &&
    (p.vigente_hasta == null || p.vigente_hasta >= hoy);
  return {
    nombre: p.nombre,
    detalle,
    total: total == null ? null : Number(total),
    vigencia: p.vigente_hasta ? `hasta ${fechaCorta(p.vigente_hasta)}` : null,
    vigente,
  };
}

// "Ver precio" de un aviso: el precio que rige hoy en Laprida para ese SKU
// (de lista, y en efectivo si es distinto) y las promociones vigentes que lo
// incluyen; o, si el aviso es de una promoción, su total. Se calcula con el
// mismo motor que el POS (calcularPrecioVenta) y solo para lo que se pidió,
// en vez de cargar toda la lista de precios en cada pantalla. No lee costos.
export async function verPrecioAviso(
  skuId: string | null,
  promocionId: string | null,
): Promise<{ error: string } | { ok: true; datos: PrecioParaCartel }> {
  const supabase = await createClient();

  const { data: laprida } = await supabase
    .from("sucursales")
    .select("id, es_central")
    .eq("es_central", false)
    .limit(1)
    .maybeSingle();
  if (!laprida) return { error: "No se encontró la sucursal." };

  const hoy = fechaOperativa();

  if (!skuId) {
    if (!promocionId) return { error: "El aviso no tiene producto ni promoción." };
    const { data } = await supabase.from("promociones").select(SELECT_PROMO).eq("id", promocionId).maybeSingle();
    if (!data) return { error: "No se encontró la promoción." };
    return {
      ok: true,
      datos: {
        precio: null,
        precioEfectivo: null,
        promociones: [armarPromo(data as unknown as PromoFila, laprida.id, hoy)],
      },
    };
  }

  const { data: sku } = await supabase
    .from("skus")
    .select("id, unidades_contenidas, producto:productos ( categoria_id )")
    .eq("id", skuId)
    .maybeSingle();
  if (!sku) return { error: "No se encontró el producto." };

  const categoriaId =
    unaFila((sku as unknown as { producto: { categoria_id: string } | { categoria_id: string }[] | null }).producto)
      ?.categoria_id ?? "";

  const [base, override, efectivo, recargoSku, recargoCategoria, descuento, promosRaw] = await Promise.all([
    supabase.from("precios").select("precio_base").eq("sku_id", skuId).maybeSingle(),
    supabase
      .from("precios_sucursal")
      .select("precio_override")
      .eq("sucursal_id", laprida.id)
      .eq("sku_id", skuId)
      .maybeSingle(),
    supabase
      .from("precios_efectivo")
      .select("precio_efectivo")
      .eq("sucursal_id", laprida.id)
      .eq("sku_id", skuId)
      .maybeSingle(),
    supabase.from("recargos_sku").select("monto_fijo").eq("sucursal_id", laprida.id).eq("sku_id", skuId).maybeSingle(),
    supabase
      .from("recargos_sucursal")
      .select("monto_fijo")
      .eq("sucursal_id", laprida.id)
      .eq("categoria_id", categoriaId)
      .maybeSingle(),
    supabase
      .from("descuentos_efectivo")
      .select("porcentaje")
      .eq("sucursal_id", laprida.id)
      .eq("categoria_id", categoriaId)
      .maybeSingle(),
    supabase.from("promocion_items").select(`promocion:promociones ( ${SELECT_PROMO} )`).eq("sku_id", skuId),
  ]);

  const precio = calcularPrecioVenta(
    { id: skuId, categoriaId, unidadesContenidas: sku.unidades_contenidas },
    { id: laprida.id, esCentral: false },
    {
      costoActualPropio: null,
      overridePrecio: override.data?.precio_override ?? null,
      precioBaseManual: base.data?.precio_base ?? null,
      recargoSkuMonto: recargoSku.data?.monto_fijo ?? null,
      recargoCategoriaMonto: recargoCategoria.data?.monto_fijo ?? null,
      descuentoEfectivoPct: descuento.data?.porcentaje ?? null,
      precioEfectivoSku: efectivo.data?.precio_efectivo ?? null,
    },
  );

  // Solo las promociones que hoy corren en Laprida con precio cargado.
  const promociones = ((promosRaw.data ?? []) as unknown as { promocion: PromoFila | PromoFila[] | null }[])
    .map((f) => unaFila(f.promocion))
    .filter((p): p is PromoFila => p != null)
    .filter((p) => p.sucursal_id == null || p.sucursal_id === laprida.id)
    .map((p) => armarPromo(p, laprida.id, hoy))
    .filter((p) => p.vigente && p.total != null);

  const efectivoDistinto =
    precio.precioEfectivo != null &&
    precio.precioOtroMedio != null &&
    Math.abs(precio.precioEfectivo - precio.precioOtroMedio) >= 0.005;

  return {
    ok: true,
    datos: {
      precio: precio.precioOtroMedio,
      precioEfectivo: efectivoDistinto ? precio.precioEfectivo : null,
      promociones,
    },
  };
}

// Marca avisos de precio/promo de Laprida como resueltos ("ya cambié el
// cartel"). Sin PIN: es lo opuesto de sensible, es la empleada confirmando
// que hizo el trabajo físico de cambiar el cartel.

function revalidar() {
  revalidatePath("/");
  revalidatePath("/reportes/alertas");
  revalidatePath("/precios");
}

// Un cartel: resuelve todas las filas pendientes de ese producto o promo.
export async function marcarAvisoPrecioResuelto(ids: string[]): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  for (const id of ids) {
    const { error } = await supabase.rpc("marcar_aviso_precio_resuelto", { p_id: id });
    if (error) return { error: error.message };
  }

  revalidar();
  return { ok: true };
}

// "Ya cambié todos los carteles": una sola llamada, no una por aviso.
// Requiere 20261110090000_avisos_precio_resolver_todos.sql.
export async function marcarTodosAvisosPrecioResueltos(): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("marcar_avisos_precio_resueltos");
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}
