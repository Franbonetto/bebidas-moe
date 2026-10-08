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
         unidades_contenidas, costo_actual, es_retornable, tipo_envase_id,
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
         promocion_items ( sku_id, cantidad_requerida ),
         promocion_precios ( sucursal_id, precio_total )`,
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
      // Un producto particular no tiene SKU: no cuenta para "lo más vendido".
      if (!it.sku_id) continue;
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
    };

    const precio = calcularPrecioVenta(skuParaPrecio, sucursalParaPrecio, {
      costoActualPropio: s.costo_actual,
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

  // El precio de una promo es el TOTAL que paga el cliente, y es por
  // sucursal (20261010090000_promocion_precio_total.sql). Si no hay fila
  // para esta sucursal, la promo no corre acá.
  const totalPorPromo = new Map<string, number>();
  for (const p of promocionesVigentes) {
    const fila = (p.promocion_precios ?? []).find((f) => f.sucursal_id === sucursal.id);
    if (fila) totalPorPromo.set(p.id, fila.precio_total);
  }

  const conPrecio = promocionesVigentes.filter((p) => totalPorPromo.has(p.id));

  // Precio de lista de un SKU en esta sucursal: la base sobre la que se
  // reparte el total del combo.
  const listaPorSku = new Map(skusPos.map((s) => [s.id, s.precioOtroMedio ?? 0]));

  const combos: ComboData[] = conPrecio
    .filter((p) => p.tipo === "combo")
    .map((p) => {
      const items = p.promocion_items ?? [];
      const total = totalPorPromo.get(p.id) ?? 0;

      // Reparto proporcional al precio de lista de cada producto: mantiene
      // el peso relativo de cada uno dentro del combo, así el aviso de
      // "precio bajo el costo" sigue teniendo sentido línea por línea. Es
      // una cuenta interna -- el ticket muestra el nombre de la promo y el
      // total, no este desglose.
      const listaTotal = items.reduce(
        (acc, it) => acc + (listaPorSku.get(it.sku_id) ?? 0) * it.cantidad_requerida,
        0,
      );

      return {
        id: p.id,
        nombre: p.nombre,
        prioridad: p.prioridad,
        items: items.map((it, i) => {
          const pesoLista = (listaPorSku.get(it.sku_id) ?? 0) * it.cantidad_requerida;
          // Sin precios de lista cargados no hay proporción posible: se
          // reparte en partes iguales, que es lo menos sorprendente.
          const porcion =
            listaTotal > 0 ? (total * pesoLista) / listaTotal : total / Math.max(items.length, 1);
          // El redondeo se acumula en la última línea para que la suma dé
          // exactamente el total que se cargó, ni un peso más ni uno menos.
          const precioItem =
            i === items.length - 1
              ? total -
                items.slice(0, -1).reduce((acc, otro) => {
                  const peso = (listaPorSku.get(otro.sku_id) ?? 0) * otro.cantidad_requerida;
                  const parte =
                    listaTotal > 0
                      ? (total * peso) / listaTotal
                      : total / Math.max(items.length, 1);
                  return acc + Math.round(parte * 100) / 100;
                }, 0)
              : Math.round(porcion * 100) / 100;

          return {
            skuId: it.sku_id,
            cantidadRequerida: it.cantidad_requerida,
            precioPromocional: precioItem,
            bajoCosto: bajoCostoPromo(it.sku_id, precioItem, it.cantidad_requerida),
          };
        }),
      };
    });

  // En un 2x no hay nada que repartir: el total ES el precio de ese SKU por
  // la cantidad del combo.
  const promosCantidad: PromoCantidadData[] = conPrecio
    .filter((p) => p.tipo === "cantidad" && (p.promocion_items ?? []).length === 1)
    .map((p) => {
      const total = totalPorPromo.get(p.id) ?? 0;
      const item = p.promocion_items[0];
      return {
        id: p.id,
        nombre: p.nombre,
        skuId: item.sku_id,
        cantidadRequerida: item.cantidad_requerida,
        precioPromocional: total,
        bajoCosto: bajoCostoPromo(item.sku_id, total, item.cantidad_requerida),
      };
    });

  return {
    skusPos,
    combos,
    promosCantidad,
    puedeFacturar,
    cajaHoy: cajaHoy ?? null,
    cantidadTicketsHoy: cantidadTicketsHoy ?? 0,
  };
}
