import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularPrecioVenta, type SkuParaPrecio, type SucursalParaPrecio } from "@/lib/precios";
import type { SkuPos, ComboData, PromoCantidadData } from "../_components/pos-client";

// Extraído de app/(app)/vender/page.tsx para poder reusarlo en /envios
// (mismo motor de precios/stock/promos/caja, ver plan del usuario
// 2026-09-21: "es lo mismo q punto de venta mas chico").

export type DatosVenta = {
  skusPos: SkuPos[];
  combos: ComboData[];
  promosCantidad: PromoCantidadData[];
  puedeFacturar: boolean;
  cajaHoy: { id: string; estado: string; monto_apertura: number; cantidad_tickets: number } | null;
  cantidadTicketsHoy: number;
};

export async function cargarDatosVenta(
  supabase: SupabaseClient,
  sucursal: { id: string; es_central: boolean },
): Promise<DatosVenta> {
  const [
    { data: skusRaw },
    { data: precios },
    { data: preciosSucursal },
    { data: recargosSucursal },
    { data: recargosSku },
    { data: descuentosEfectivo },
    { data: stockRaw },
    { data: promocionesRaw },
    { data: cajaHoy },
    { data: puntoVenta },
  ] = await Promise.all([
    supabase
      .from("skus")
      .select(
        `id, nombre, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen,
         unidades_contenidas, cascada_cerveza_lata, costo_actual, es_retornable, tipo_envase_id,
         desarma_en_sku_id, desarma_en_cantidad,
         producto:productos ( id, nombre, categoria_id, marca:marcas ( nombre ) ),
         tipo_envase:tipos_envase ( valor_deposito )`,
      )
      .eq("activo", true),
    supabase.from("precios").select("sku_id, precio_base"),
    supabase.from("precios_sucursal").select("sucursal_id, sku_id, precio_override").eq("sucursal_id", sucursal.id),
    supabase.from("recargos_sucursal").select("categoria_id, monto_fijo").eq("sucursal_id", sucursal.id),
    supabase.from("recargos_sku").select("sku_id, monto_fijo").eq("sucursal_id", sucursal.id),
    supabase.from("descuentos_efectivo").select("categoria_id, porcentaje").eq("sucursal_id", sucursal.id),
    supabase.from("stock_sucursal").select("sku_id, cantidad").eq("sucursal_id", sucursal.id),
    supabase
      .from("promociones")
      .select(
        `id, nombre, tipo, prioridad, vigente_desde, vigente_hasta,
         promocion_items ( sku_id, cantidad_requerida, precio_promocional )`,
      )
      .eq("activo", true)
      .or(`sucursal_id.is.null,sucursal_id.eq.${sucursal.id}`),
    supabase
      .from("cajas")
      .select("id, estado, monto_apertura, cantidad_tickets")
      .eq("sucursal_id", sucursal.id)
      .eq("fecha", new Date().toISOString().slice(0, 10))
      .maybeSingle(),
    supabase
      .from("puntos_venta")
      .select("id")
      .eq("sucursal_id", sucursal.id)
      .eq("activo", true)
      .maybeSingle(),
  ]);

  // El botón "Facturar" depende de si ESTA sucursal tiene punto de venta
  // ARCA activo, no de si es la sucursal central (antes solo facturaba
  // Olavarría, ver 20260917090000_arca_multisucursal.sql).
  const puedeFacturar = puntoVenta !== null;

  const desde = new Date();
  desde.setDate(desde.getDate() - 30);
  const { data: ventasRecientes } = await supabase
    .from("ventas")
    .select("venta_items ( sku_id, cantidad )")
    .eq("sucursal_id", sucursal.id)
    .eq("estado", "confirmada")
    .gte("fecha", desde.toISOString())
    .limit(500);

  const vendidosPorSku = new Map<string, number>();
  for (const v of ventasRecientes ?? []) {
    for (const it of v.venta_items ?? []) {
      vendidosPorSku.set(it.sku_id, (vendidosPorSku.get(it.sku_id) ?? 0) + it.cantidad);
    }
  }

  const { count: cantidadTicketsHoy } = cajaHoy?.id
    ? await supabase
        .from("ventas")
        .select("id", { count: "exact", head: true })
        .eq("caja_id", cajaHoy.id)
    : { count: 0 };

  const precioBasePorSku = new Map<string, number>();
  for (const p of precios ?? []) precioBasePorSku.set(p.sku_id, p.precio_base);

  const overridePorSku = new Map<string, number>();
  for (const p of preciosSucursal ?? []) overridePorSku.set(p.sku_id, p.precio_override);

  const recargoCategoriaPorId = new Map<string, number>();
  for (const r of recargosSucursal ?? []) recargoCategoriaPorId.set(r.categoria_id, r.monto_fijo);

  const recargoSkuPorId = new Map<string, number>();
  for (const r of recargosSku ?? []) recargoSkuPorId.set(r.sku_id, r.monto_fijo);

  const descuentoPorCategoria = new Map<string, number>();
  for (const d of descuentosEfectivo ?? []) descuentoPorCategoria.set(d.categoria_id, d.porcentaje);

  const stockPorSku = new Map<string, number>();
  for (const s of stockRaw ?? []) stockPorSku.set(s.sku_id, s.cantidad);

  type SkuFila = {
    id: string;
    nombre: string;
    codigo_interno: string;
    codigo_barras: string | null;
    tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
    volumen: number;
    unidad_volumen: string;
    unidades_contenidas: number;
    cascada_cerveza_lata: boolean;
    costo_actual: number | null;
    es_retornable: boolean;
    tipo_envase_id: string | null;
    desarma_en_sku_id: string | null;
    desarma_en_cantidad: number | null;
    producto: { id: string; nombre: string; categoria_id: string; marca: { nombre: string } | null } | null;
    tipo_envase: { valor_deposito: number } | null;
  };

  const skusList = (skusRaw ?? []) as unknown as SkuFila[];
  const sucursalParaPrecio: SucursalParaPrecio = { id: sucursal.id, esCentral: sucursal.es_central };

  const costoX24PorProducto = new Map<string, number | null>();
  for (const s of skusList) {
    if (s.cascada_cerveza_lata && s.unidades_contenidas === 24 && s.producto) {
      costoX24PorProducto.set(s.producto.id, s.costo_actual);
    }
  }

  // Para el atajo de desarme (arquitectura.md 1.3): dado un SKU sin stock
  // suficiente, encontrar el SKU "padre" (el que se desarma EN este) dentro
  // de la misma familia de producto.
  const padreDesarmePorHijo = new Map<string, { id: string; cantidad: number }>();
  for (const s of skusList) {
    if (s.desarma_en_sku_id) {
      padreDesarmePorHijo.set(s.desarma_en_sku_id, { id: s.id, cantidad: s.desarma_en_cantidad ?? 1 });
    }
  }

  // Solo para uso interno de esta función (ver combos/promosCantidad más
  // abajo): nunca se manda al cliente. El número de costo en sí es
  // información restringida (arquitectura.md 1.7/1.11); lo único que cruza
  // al navegador es el booleano "bajoCosto" ya resuelto.
  const costoReferenciaPorSku = new Map<string, number | null>();

  const skusPos: SkuPos[] = skusList.map((s) => {
    const categoriaId = s.producto?.categoria_id ?? "";
    const skuParaPrecio: SkuParaPrecio = {
      id: s.id,
      categoriaId,
      unidadesContenidas: s.unidades_contenidas,
      cascadaCervezaLata: s.cascada_cerveza_lata,
    };

    const precio = calcularPrecioVenta(skuParaPrecio, sucursalParaPrecio, {
      costoActualPropio: s.costo_actual,
      costoActualX24Familia: s.producto ? (costoX24PorProducto.get(s.producto.id) ?? null) : null,
      overridePrecio: overridePorSku.get(s.id) ?? null,
      precioBaseManual: precioBasePorSku.get(s.id) ?? null,
      recargoSkuMonto: recargoSkuPorId.get(s.id) ?? null,
      recargoCategoriaMonto: recargoCategoriaPorId.get(categoriaId) ?? null,
      descuentoEfectivoPct: descuentoPorCategoria.get(categoriaId) ?? null,
    });

    const padre = padreDesarmePorHijo.get(s.id) ?? null;
    costoReferenciaPorSku.set(s.id, precio.costoReferencia);

    return {
      id: s.id,
      nombre: s.producto?.nombre ?? s.nombre,
      marcaNombre: s.producto?.marca?.nombre ?? null,
      codigoInterno: s.codigo_interno,
      codigoBarras: s.codigo_barras,
      presentacion: {
        tipo_presentacion: s.tipo_presentacion,
        volumen: s.volumen,
        unidad_volumen: s.unidad_volumen,
        unidades_contenidas: s.unidades_contenidas,
      },
      esRetornable: s.es_retornable,
      valorDeposito: s.tipo_envase?.valor_deposito ?? 0,
      padreDesarme: padre,
      stock: stockPorSku.get(s.id) ?? 0,
      precioEfectivo: precio.precioEfectivo,
      precioOtroMedio: precio.precioOtroMedio,
      origen: precio.origen,
      bajoCostoEfectivo: precio.bajoCostoEfectivo,
      vendidosUltimos30Dias: vendidosPorSku.get(s.id) ?? 0,
    };
  });

  function bajoCostoPromo(skuId: string, precioPromocional: number, cantidadRequerida: number) {
    const costo = costoReferenciaPorSku.get(skuId) ?? null;
    if (costo == null) return false;
    return precioPromocional / cantidadRequerida < costo;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const promocionesVigentes = (promocionesRaw ?? []).filter(
    (p) =>
      (p.vigente_desde == null || p.vigente_desde <= hoy) &&
      (p.vigente_hasta == null || p.vigente_hasta >= hoy),
  );

  const combos: ComboData[] = promocionesVigentes
    .filter((p) => p.tipo === "combo")
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      prioridad: p.prioridad,
      items: (p.promocion_items ?? []).map((it) => ({
        skuId: it.sku_id,
        cantidadRequerida: it.cantidad_requerida,
        precioPromocional: it.precio_promocional,
        bajoCosto: bajoCostoPromo(it.sku_id, it.precio_promocional, it.cantidad_requerida),
      })),
    }));

  const promosCantidad: PromoCantidadData[] = promocionesVigentes
    .filter((p) => p.tipo === "cantidad" && (p.promocion_items ?? []).length === 1)
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      skuId: p.promocion_items[0].sku_id,
      cantidadRequerida: p.promocion_items[0].cantidad_requerida,
      precioPromocional: p.promocion_items[0].precio_promocional,
      bajoCosto: bajoCostoPromo(
        p.promocion_items[0].sku_id,
        p.promocion_items[0].precio_promocional,
        p.promocion_items[0].cantidad_requerida,
      ),
    }));

  return {
    skusPos,
    combos,
    promosCantidad,
    puedeFacturar,
    cajaHoy: cajaHoy ?? null,
    cantidadTicketsHoy: cantidadTicketsHoy ?? 0,
  };
}
