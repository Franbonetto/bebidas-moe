import { createClient } from "@/lib/supabase/server";
import {
  MOTIVO_INVENTARIO_LABEL,
  type MotivoInventario,
} from "@/app/(app)/inventarios/_components/estado-inventario-badge";
import { TIPO_MOVIMIENTO_LABEL, motivoLegible } from "@/lib/movimientos";
import { formatoFecha, formatoFechaHora, formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import {
  calcularCostosQueSubieron,
  calcularMercaderiaInmovilizada,
  calcularProductosPorVencer,
  calcularResumenVentas,
  inicioDeSemana,
  topProductosVendidos,
  type ProductoPorVencer,
  type ProductoVendido,
  type ResumenVentas,
} from "./lib";
import { AutoRefresh } from "../auto-refresh";
import { AlertRow, Badge, BarRow, Card, EmptyState, Kpi, KpiGrid, SectionHeader, StatRow } from "./ui";

type Sucursal = { id: string; nombre: string; es_central: boolean };

type SkuInfo = {
  id: string;
  nombre: string;
  stock_minimo: number;
  costo_actual: number | null;
  tipo_presentacion: SkuPresentacion["tipo_presentacion"];
  volumen: number;
  unidad_volumen: string;
  unidades_contenidas: number;
  producto: { nombre: string; marca: { nombre: string } | null; categoria: { nombre: string } | null } | null;
};

type PrecioBaseFila = {
  sku_id: string;
  precio_base: number;
  actualizado_en: string;
  usuario: { nombre: string } | null;
};

type PrecioSucursalFila = {
  sku_id: string;
  sucursal_id: string;
  precio_override: number;
  actualizado_en: string;
  usuario: { nombre: string } | null;
};

type PrecioCargado = {
  key: string;
  skuId: string;
  sucursalNombre: string;
  tipo: "base" | "excepción";
  precio: number;
  margenPct: number | null;
  actualizadoEn: string;
  usuarioNombre: string;
};

type MovimientoReciente = {
  id: string;
  tipo: string;
  cantidad: number;
  fecha: string;
  motivo: string | null;
  usuario: { nombre: string } | null;
  sucursal: { nombre: string } | null;
  sku: { nombre: string; producto: { nombre: string } | null } | null;
};

function nombreSku(sku: SkuInfo | undefined) {
  return sku?.producto?.nombre ?? sku?.nombre ?? "SKU eliminado";
}

// Bloque por sucursal: ventas, top vendidos, stock y vencimientos. Es lo
// que reemplaza al panel "igual que el del encargado con algunos datos
// más" (pedido del usuario 2026-09-22) -- acá el dueño ve cada sucursal
// por separado, sin accesos a tareas operativas (eso vive en los paneles
// de cada encargado).
function BloqueSucursal({
  nombre,
  caja,
  resumenVentas,
  topVendidos,
  skuPorId,
  stockTotal,
  sinStock,
  bajoMinimo,
  porVencer,
}: {
  nombre: string;
  caja: { estado: "abierta" | "cerrada" } | undefined;
  resumenVentas: ResumenVentas;
  topVendidos: ProductoVendido[];
  skuPorId: Map<string, SkuInfo>;
  stockTotal: number;
  sinStock: number;
  bajoMinimo: number;
  porVencer: ProductoPorVencer[];
}) {
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-text">{nombre}</h3>
        <span
          className={`rounded-[5px] px-[7px] py-[2px] text-[11px] font-medium ${
            caja?.estado === "abierta" ? "bg-ok-bg text-ok" : "bg-bg-2 text-text-2"
          }`}
        >
          Caja {caja ? (caja.estado === "abierta" ? "abierta" : "cerrada") : "sin abrir"}
        </span>
      </div>

      <Card title="Ventas">
        <div className="flex flex-col divide-y divide-[#F1F1F3]">
          <StatRow label="Vendido hoy" value={formatoMoneda.format(resumenVentas.vendidoHoy)} />
          <StatRow
            label="Vendido esta semana"
            value={formatoMoneda.format(resumenVentas.vendidoSemana)}
            sub="Lunes a hoy"
          />
          <StatRow label="Vendido este mes" value={formatoMoneda.format(resumenVentas.vendidoMes)} />
          <StatRow
            label="Ticket promedio"
            value={formatoMoneda.format(resumenVentas.ticketPromedio)}
            sub={`${resumenVentas.cantidadTickets} ticket${resumenVentas.cantidadTickets === 1 ? "" : "s"} · últimos 30 días`}
          />
        </div>
      </Card>

      <Card title="Más vendidos · últimos 30 días">
        {topVendidos.length === 0 ? (
          <EmptyState title="Sin ventas registradas" sub="Todavía no hay ventas en los últimos 30 días." />
        ) : (
          <div className="flex flex-col">
            {topVendidos.map((p, i) => {
              const sku = skuPorId.get(p.sku_id);
              return (
                <div
                  key={p.sku_id}
                  className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[9px] last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-[9px]">
                    <span className="w-[16px] shrink-0 text-[11.5px] tabular-nums text-text-3">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{nombreSku(sku)}</p>
                      <p className="truncate text-[11.5px] text-text-3">
                        {sku ? [sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ") : ""}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-[13px] font-medium tabular-nums text-text">{p.unidades} u.</p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <Card title="Stock">
          <div className="flex flex-col divide-y divide-[#F1F1F3]">
            <StatRow label="Total" value={`${stockTotal} u.`} />
            <StatRow label="Sin stock" value={sinStock} />
            <StatRow label="Bajo mínimo" value={bajoMinimo} />
          </div>
        </Card>

        <Card title="Próximos a vencer · 30 días">
          {porVencer.length === 0 ? (
            <EmptyState title="Sin vencimientos" sub="Nada vence en los próximos 30 días." />
          ) : (
            <div className="flex flex-col">
              {porVencer.slice(0, 6).map((v) => {
                const sku = skuPorId.get(v.sku_id);
                return (
                  <div
                    key={v.sku_id}
                    className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[8px] last:border-b-0"
                  >
                    <p className="min-w-0 truncate text-[12.5px] text-text">{nombreSku(sku)}</p>
                    <Badge color={v.dias_restantes < 0 ? "err" : v.dias_restantes <= 7 ? "warn" : "info"}>
                      {v.dias_restantes < 0 ? "Vencido" : v.dias_restantes === 0 ? "Hoy" : `${v.dias_restantes} d.`}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export async function DuenoDashboard() {
  const supabase = await createClient();

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const ahora = new Date().getTime();
  const cutoff30 = new Date(ahora - 30 * 86_400_000).toISOString();
  const cutoff7 = new Date(ahora - 7 * 86_400_000).toISOString();
  const hoy = new Date().toISOString().slice(0, 10);
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const inicioSemana = inicioDeSemana(new Date());

  const [
    { data: sucursales },
    { data: skus },
    { data: stock },
    { data: movimientos },
    { data: historial },
    { data: compras },
    { data: recepcionesCompra },
    { data: transferenciasEnTransito },
    { data: pedidosAbiertos },
    { data: inventariosCerrados30d },
    { data: cajasHoy },
    { data: preciosRecientes },
    { data: preciosSucursalRecientes },
    { data: ventasHoy },
    { data: ventasSemana },
    { data: ventasMes },
    { data: ventas30 },
  ] = await Promise.all([
    supabase.from("sucursales").select("id, nombre, es_central").eq("activo", true).order("es_central", { ascending: false }),
    supabase
      .from("skus")
      .select(
        `id, nombre, stock_minimo, costo_actual, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ), categoria:categorias ( nombre ) )`,
      )
      .eq("activo", true),
    supabase.from("stock_sucursal").select("sku_id, sucursal_id, cantidad"),
    supabase
      .from("movimientos_stock")
      .select(
        `id, tipo, cantidad, fecha, motivo, sku_id,
         usuario:usuarios ( nombre ), sucursal:sucursales ( nombre ),
         sku:skus ( nombre, producto:productos ( nombre ) )`,
      )
      .order("fecha", { ascending: false }),
    supabase
      .from("historial_costos")
      .select("sku_id, costo_unitario, fecha, fecha_vencimiento")
      .order("fecha", { ascending: false }),
    // Sin filtro de fecha acá: fecha_factura es opcional (compra-form.tsx la
    // manda null si no se cargó) y un gte() contra una columna null la
    // descarta en silencio. El recorte por mes se hace después, en JS, con
    // fallback a la primera recepción cuando no hay fecha_factura.
    supabase.from("compras").select("id, total, estado, fecha_factura").neq("estado", "borrador"),
    supabase.from("recepciones_compra").select("compra_id, fecha"),
    supabase.from("transferencias").select("id").eq("estado", "en_transito"),
    supabase.from("pedidos").select("id").not("estado", "in", "(borrador,cerrado)"),
    supabase.from("inventarios").select("id").eq("estado", "cerrado").gte("fecha_fin", cutoff30),
    supabase
      .from("cajas")
      .select("sucursal_id, estado, monto_apertura, cantidad_tickets, ventas ( total )")
      .eq("fecha", hoy),
    supabase
      .from("precios")
      .select("sku_id, precio_base, actualizado_en, usuario:usuarios ( nombre )")
      .gte("actualizado_en", cutoff7)
      .order("actualizado_en", { ascending: false }),
    supabase
      .from("precios_sucursal")
      .select("sku_id, sucursal_id, precio_override, actualizado_en, usuario:usuarios ( nombre )")
      .gte("actualizado_en", cutoff7)
      .order("actualizado_en", { ascending: false }),
    supabase.from("ventas").select("sucursal_id, total").eq("estado", "confirmada").gte("fecha", inicioHoy.toISOString()),
    supabase.from("ventas").select("sucursal_id, total").eq("estado", "confirmada").gte("fecha", inicioSemana.toISOString()),
    supabase.from("ventas").select("sucursal_id, total").eq("estado", "confirmada").gte("fecha", inicioMes.toISOString()),
    supabase.from("ventas").select("id, sucursal_id, total").eq("estado", "confirmada").gte("fecha", cutoff30),
  ]);

  const sucursalesList = (sucursales ?? []) as Sucursal[];
  const skusList = (skus ?? []) as unknown as SkuInfo[];
  const movimientosList = (movimientos ?? []) as unknown as (MovimientoReciente & { sku_id: string })[];

  const skuPorId = new Map(skusList.map((s) => [s.id, s]));
  const sucursalNombrePorId = new Map(sucursalesList.map((s) => [s.id, s.nombre]));
  const sucursalCentral = sucursalesList.find((s) => s.es_central);

  // Items vendidos en los últimos 30 días, para "más vendidos" por
  // sucursal -- se busca aparte porque depende de los ids de ventas30.
  const ventas30List = (ventas30 ?? []) as { id: string; sucursal_id: string; total: number }[];
  const ventaIds = ventas30List.map((v) => v.id);
  const { data: itemsVendidos } = ventaIds.length
    ? await supabase.from("venta_items").select("venta_id, sku_id, cantidad").in("venta_id", ventaIds)
    : { data: [] as { venta_id: string; sku_id: string; cantidad: number }[] };

  const sucursalPorVentaId = new Map(ventas30List.map((v) => [v.id, v.sucursal_id]));
  const itemsVendidosList = (itemsVendidos ?? []) as { venta_id: string; sku_id: string; cantidad: number }[];

  // Caja del día + vendido hoy/mes/ticket promedio, por sucursal.
  type CajaFila = {
    sucursal_id: string;
    estado: "abierta" | "cerrada";
    monto_apertura: number;
    cantidad_tickets: number | null;
    ventas: { total: number }[];
  };
  const cajaPorSucursal = new Map(
    ((cajasHoy ?? []) as unknown as CajaFila[]).map((c) => [c.sucursal_id, { estado: c.estado }]),
  );

  const ventasHoyList = (ventasHoy ?? []) as { sucursal_id: string; total: number }[];
  const ventasSemanaList = (ventasSemana ?? []) as { sucursal_id: string; total: number }[];
  const ventasMesList = (ventasMes ?? []) as { sucursal_id: string; total: number }[];

  // Precios cargados en los últimos 7 días: base (Olavarría) + excepciones
  // por sucursal, en una sola lista ordenada por fecha. Control detectivo
  // (CLAUDE.md, arquitectura.md 1.11): el encargado de Olavarría carga
  // precios sin aprobación previa, esto es lo que reemplaza esa aprobación.
  const margenPct = (precio: number, costo: number | null) =>
    costo == null || precio <= 0 ? null : ((precio - costo) / precio) * 100;

  const preciosCargados: PrecioCargado[] = [
    ...((preciosRecientes ?? []) as unknown as PrecioBaseFila[]).map((p) => {
      const sku = skuPorId.get(p.sku_id);
      return {
        key: `base:${p.sku_id}:${p.actualizado_en}`,
        skuId: p.sku_id,
        sucursalNombre: sucursalCentral?.nombre ?? "Olavarría",
        tipo: "base" as const,
        precio: p.precio_base,
        margenPct: sku ? margenPct(p.precio_base, sku.costo_actual) : null,
        actualizadoEn: p.actualizado_en,
        usuarioNombre: p.usuario?.nombre ?? "—",
      };
    }),
    ...((preciosSucursalRecientes ?? []) as unknown as PrecioSucursalFila[]).map((p) => {
      const sku = skuPorId.get(p.sku_id);
      return {
        key: `excepcion:${p.sucursal_id}:${p.sku_id}:${p.actualizado_en}`,
        skuId: p.sku_id,
        sucursalNombre: sucursalNombrePorId.get(p.sucursal_id) ?? "—",
        tipo: "excepción" as const,
        precio: p.precio_override,
        margenPct: sku ? margenPct(p.precio_override, sku.costo_actual) : null,
        actualizadoEn: p.actualizado_en,
        usuarioNombre: p.usuario?.nombre ?? "—",
      };
    }),
  ].sort((a, b) => (a.actualizadoEn < b.actualizadoEn ? 1 : -1));

  const stockPorSku = new Map<string, Record<string, number>>();
  for (const fila of (stock ?? []) as { sku_id: string; sucursal_id: string; cantidad: number }[]) {
    const porSucursal = stockPorSku.get(fila.sku_id) ?? {};
    porSucursal[fila.sucursal_id] = fila.cantidad;
    stockPorSku.set(fila.sku_id, porSucursal);
  }

  // Stock total por sucursal (solo SKU activos).
  const stockTotalPorSucursal: Record<string, number> = {};
  for (const sucursal of sucursalesList) stockTotalPorSucursal[sucursal.id] = 0;
  for (const sku of skusList) {
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    for (const sucursal of sucursalesList) {
      stockTotalPorSucursal[sucursal.id] += porSucursal[sucursal.id] ?? 0;
    }
  }
  const stockTotal = Object.values(stockTotalPorSucursal).reduce((a, b) => a + b, 0);

  // Bajo mínimo / sin stock, con desglose por sucursal.
  const bajoMinimoPorSucursal: Record<string, number> = {};
  const sinStockPorSucursal: Record<string, number> = {};
  const skusSinStock = new Set<string>();
  for (const sucursal of sucursalesList) {
    bajoMinimoPorSucursal[sucursal.id] = 0;
    sinStockPorSucursal[sucursal.id] = 0;
  }
  for (const sku of skusList) {
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    for (const sucursal of sucursalesList) {
      const cantidad = porSucursal[sucursal.id] ?? 0;
      if (cantidad <= 0) {
        sinStockPorSucursal[sucursal.id] += 1;
        skusSinStock.add(sku.id);
      }
      if (sku.stock_minimo > 0 && cantidad < sku.stock_minimo) {
        bajoMinimoPorSucursal[sucursal.id] += 1;
      }
    }
  }

  // Mercadería inmovilizada: SKU con stock hoy y hace cuánto no se venden
  // (no "último movimiento" en general -- ver lib.ts, pedido del usuario
  // 2026-09-22). 90+ días sin venta (o nunca vendido) es el umbral para el
  // KPI resumen; la lista completa (30-40 productos) se muestra abajo.
  const ventasParaInmovilizado = movimientosList.filter((m) => m.tipo === "venta");
  const stockTotalPorSkuList = skusList.map((sku) => {
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    return { sku_id: sku.id, stock: Object.values(porSucursal).reduce((a, b) => a + b, 0) };
  });
  const mercaderiaInmovilizada = calcularMercaderiaInmovilizada(stockTotalPorSkuList, ventasParaInmovilizado);
  const inmovilizados90d = mercaderiaInmovilizada.filter((p) => p.dias_sin_venta == null || p.dias_sin_venta >= 90);
  const inmovilizadosCount = inmovilizados90d.length;
  const inmovilizadosUnidades = inmovilizados90d.reduce((acc, p) => acc + p.stock, 0);

  // Stock a costo de compra, por categoría (no es precio de venta).
  const costoPorCategoria = new Map<string, number>();
  for (const sku of skusList) {
    if (sku.costo_actual == null) continue;
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    const total = Object.values(porSucursal).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    const categoria = sku.producto?.categoria?.nombre ?? "Sin categoría";
    costoPorCategoria.set(categoria, (costoPorCategoria.get(categoria) ?? 0) + total * sku.costo_actual);
  }
  const barsCategorias = [...costoPorCategoria.entries()].sort((a, b) => b[1] - a[1]);
  const maxCategoria = barsCategorias[0]?.[1] ?? 0;

  const costosSubieron = calcularCostosQueSubieron(
    (historial ?? []) as { sku_id: string; costo_unitario: number; fecha: string }[],
  );

  const historialConVencimiento = (historial ?? []) as {
    sku_id: string;
    fecha_vencimiento: string | null;
    fecha: string;
  }[];
  const porVencerGlobal = calcularProductosPorVencer(historialConVencimiento);

  // "Compras del mes": confirmadas + cerradas cuya fecha efectiva cae en el
  // mes en curso. fecha_factura manda cuando está cargada; si no, se usa la
  // fecha de la primera recepción (siempre tiene valor, es default now()).
  const primeraRecepcionPorCompra = new Map<string, string>();
  for (const r of (recepcionesCompra ?? []) as { compra_id: string; fecha: string }[]) {
    const actual = primeraRecepcionPorCompra.get(r.compra_id);
    if (!actual || r.fecha < actual) primeraRecepcionPorCompra.set(r.compra_id, r.fecha);
  }
  const inicioMesTime = inicioMes.getTime();
  let comprasMesTotal = 0;
  let comprasMesCount = 0;
  for (const c of (compras ?? []) as { id: string; total: number; fecha_factura: string | null }[]) {
    const fechaEfectiva = c.fecha_factura
      ? new Date(c.fecha_factura).getTime()
      : primeraRecepcionPorCompra.has(c.id)
        ? new Date(primeraRecepcionPorCompra.get(c.id)!).getTime()
        : null;
    if (fechaEfectiva == null || fechaEfectiva < inicioMesTime) continue;
    comprasMesTotal += Number(c.total);
    comprasMesCount += 1;
  }

  // Diferencias de inventario por motivo, últimos 30 días.
  const idsInventariosCerrados = (inventariosCerrados30d ?? []).map((i) => i.id);
  const { data: itemsConDiferencia } = idsInventariosCerrados.length
    ? await supabase
        .from("inventario_items")
        .select("motivo, diferencia")
        .in("inventario_id", idsInventariosCerrados)
        .neq("diferencia", 0)
    : { data: [] as { motivo: MotivoInventario | null; diferencia: number }[] };

  const porMotivo = new Map<string, { count: number; unidades: number }>();
  for (const item of (itemsConDiferencia ?? []) as { motivo: MotivoInventario | null; diferencia: number }[]) {
    const motivo = item.motivo ?? "desconocido";
    const actual = porMotivo.get(motivo) ?? { count: 0, unidades: 0 };
    actual.count += 1;
    actual.unidades += Math.abs(item.diferencia);
    porMotivo.set(motivo, actual);
  }
  const barsMotivos = [...porMotivo.entries()].sort((a, b) => b[1].unidades - a[1].unidades);
  const maxMotivo = barsMotivos[0]?.[1].unidades ?? 0;

  const movimientosRecientes = movimientosList.slice(0, 8);

  const vendidoHoyTotal = ventasHoyList.reduce((acc, v) => acc + v.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />

      <div>
        <SectionHeader title="Resumen" />
        <KpiGrid>
          <Kpi label="Vendido hoy" value={formatoMoneda.format(vendidoHoyTotal)} />
          <Kpi
            label="Stock total (unidades)"
            value={stockTotal}
            sub={sucursalesList.map((s) => `${s.nombre} ${stockTotalPorSucursal[s.id] ?? 0}`).join(" · ")}
          />
          <Kpi
            label="Productos sin stock"
            value={skusSinStock.size}
            sub={sucursalesList.map((s) => `${s.nombre} ${sinStockPorSucursal[s.id] ?? 0}`).join(" · ")}
          />
          <Kpi
            label="Mercadería inmovilizada"
            value={inmovilizadosCount}
            sub={`${inmovilizadosUnidades} unidades · 90+ días sin venderse`}
          />
        </KpiGrid>

        {((transferenciasEnTransito ?? []).length > 0 || costosSubieron.length > 0) && (
          <div className="mt-3 flex flex-col gap-[8px]">
            {(transferenciasEnTransito ?? []).length > 0 && (
              <AlertRow
                color="info"
                title={`${(transferenciasEnTransito ?? []).length} transferencia${(transferenciasEnTransito ?? []).length === 1 ? "" : "s"} en tránsito`}
                href="/pedidos"
              />
            )}
            {costosSubieron.length > 0 && (
              <AlertRow
                color="orange"
                title={`${costosSubieron.length} costo${costosSubieron.length === 1 ? "" : "s"} aumentaron`}
                sub="Últimos 30 días — revisar precios de venta"
              />
            )}
          </div>
        )}
      </div>

      <div>
        <SectionHeader title="Mercadería inmovilizada" meta="Ordenado por hace cuánto no se vende" />
        <Card title={`${mercaderiaInmovilizada.length} productos con stock`}>
          {mercaderiaInmovilizada.length === 0 ? (
            <EmptyState title="Sin productos inmovilizados" sub="Todo el stock activo tuvo ventas recientes." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Producto
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Stock
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Última venta
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Sin venderse
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mercaderiaInmovilizada.map((p) => {
                    const sku = skuPorId.get(p.sku_id);
                    return (
                      <tr key={p.sku_id} className="border-b border-[#F1F1F3] last:border-b-0">
                        <td className="px-[14px] py-[8px] align-middle">
                          <p className="font-medium text-text">{nombreSku(sku)}</p>
                          <p className="text-[11.5px] text-text-3">
                            {sku
                              ? [sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ")
                              : ""}
                          </p>
                        </td>
                        <td className="px-[14px] py-[8px] text-right align-middle tabular-nums text-text-2">
                          {p.stock}
                        </td>
                        <td className="px-[14px] py-[8px] align-middle text-text-2">
                          {p.ultima_venta ? formatoFecha.format(new Date(p.ultima_venta)) : "Nunca se vendió"}
                        </td>
                        <td className="px-[14px] py-[8px] text-right align-middle">
                          <Badge color={p.dias_sin_venta == null || p.dias_sin_venta >= 90 ? "err" : "warn"}>
                            {p.dias_sin_venta == null ? "—" : `${p.dias_sin_venta} días`}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader title="Por sucursal" />
        <div className="grid grid-cols-1 gap-[20px] lg:grid-cols-2">
          {sucursalesList.map((s) => {
            const itemsSucursal = itemsVendidosList.filter((it) => sucursalPorVentaId.get(it.venta_id) === s.id);
            return (
              <BloqueSucursal
                key={s.id}
                nombre={s.nombre}
                caja={cajaPorSucursal.get(s.id)}
                resumenVentas={calcularResumenVentas(
                  ventasHoyList.filter((v) => v.sucursal_id === s.id),
                  ventasSemanaList.filter((v) => v.sucursal_id === s.id),
                  ventasMesList.filter((v) => v.sucursal_id === s.id),
                  ventas30List.filter((v) => v.sucursal_id === s.id),
                )}
                topVendidos={topProductosVendidos(itemsSucursal)}
                skuPorId={skuPorId}
                stockTotal={stockTotalPorSucursal[s.id] ?? 0}
                sinStock={sinStockPorSucursal[s.id] ?? 0}
                bajoMinimo={bajoMinimoPorSucursal[s.id] ?? 0}
                porVencer={porVencerGlobal.filter((v) => (stockPorSku.get(v.sku_id)?.[s.id] ?? 0) > 0)}
              />
            );
          })}
        </div>
      </div>

      <div>
        <SectionHeader title="Auditoría y costos" meta="Solo vos ves esta sección" />

        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[1.55fr_1fr]">
          <Card title="Dónde está la plata · a costo de compra">
            {barsCategorias.length === 0 ? (
              <EmptyState
                title="Todavía no hay costos cargados"
                sub="Se completa a medida que se reciben compras y se carga costo_actual por SKU."
              />
            ) : (
              <div className="flex flex-col gap-[9px] p-[14px]">
                {barsCategorias.map(([categoria, valor]) => (
                  <BarRow
                    key={categoria}
                    label={categoria}
                    value={valor}
                    max={maxCategoria}
                    display={formatoMoneda.format(valor)}
                  />
                ))}
                <p className="pt-[4px] text-[11.5px] text-text-3">
                  Costo de compra (costo_actual × stock), no precio de venta.
                </p>
              </div>
            )}
          </Card>

          <Card title="Actividad">
            <div className="flex flex-col divide-y divide-[#F1F1F3]">
              <StatRow
                label="Compras del mes"
                value={formatoMoneda.format(comprasMesTotal)}
                sub={`${comprasMesCount} compra${comprasMesCount === 1 ? "" : "s"}`}
              />
              <StatRow label="Pedidos abiertos" value={(pedidosAbiertos ?? []).length} />
              <StatRow label="Transferencias en tránsito" value={(transferenciasEnTransito ?? []).length} />
            </div>
          </Card>
        </div>

        <div className="mt-[14px] grid grid-cols-1 gap-[14px] lg:grid-cols-2">
          <Card title="Diferencias de inventario por motivo · últimos 30 días">
            {barsMotivos.length === 0 ? (
              <EmptyState
                title="Sin diferencias en los últimos 30 días"
                sub="Los inventarios cerrados en este período no encontraron faltantes ni sobrantes."
              />
            ) : (
              <div className="flex flex-col gap-[9px] p-[14px]">
                {barsMotivos.map(([motivo, datos]) => (
                  <BarRow
                    key={motivo}
                    tone="loss"
                    label={MOTIVO_INVENTARIO_LABEL[motivo as MotivoInventario] ?? motivo}
                    value={datos.unidades}
                    max={maxMotivo}
                    display={`${datos.unidades} u. · ${datos.count} ajuste${datos.count === 1 ? "" : "s"}`}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="Precios cargados · últimos 7 días">
            {preciosCargados.length === 0 ? (
              <EmptyState
                title="Sin precios cargados en los últimos 7 días"
                sub="Control detectivo: acá aparece quién cargó cada precio, para revisar sin tener que aprobar antes."
              />
            ) : (
              <div className="flex flex-col divide-y divide-[#F1F1F3]">
                {preciosCargados.slice(0, 8).map((p) => {
                  const sku = skuPorId.get(p.skuId);
                  return (
                    <div key={p.key} className="flex flex-col gap-[3px] px-[14px] py-[9px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 truncate text-[13px] font-medium text-text">{nombreSku(sku)}</p>
                        <p className="shrink-0 tabular-nums text-text">{formatoMoneda.format(p.precio)}</p>
                      </div>
                      <p className="text-[11.5px] text-text-3">
                        {p.sucursalNombre}
                        {p.tipo === "excepción" ? " · excepción manual" : ""} · Margen{" "}
                        {p.margenPct == null ? "—" : `${p.margenPct.toFixed(0)}%`} · {p.usuarioNombre}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="mt-[14px]">
          <Card title="Últimos movimientos del sistema">
            {movimientosRecientes.length === 0 ? (
              <EmptyState title="Todavía no hay movimientos" sub="Van a aparecer acá a medida que se opere el sistema." />
            ) : (
              <div className="flex flex-col divide-y divide-[#F1F1F3]">
                {movimientosRecientes.map((m) => (
                  <div key={m.id} className="flex flex-col gap-[3px] px-[14px] py-[9px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-text">{TIPO_MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}</p>
                      <p className="truncate text-[11.5px] text-text-3">
                        {m.sku?.producto?.nombre ?? m.sku?.nombre}
                        {" · "}
                        {m.cantidad > 0 ? "+" : ""}
                        {m.cantidad}
                        {motivoLegible(m.motivo, m.tipo) ? ` — ${motivoLegible(m.motivo, m.tipo)}` : ""}
                        {" · "}
                        {m.sucursal?.nombre} · {m.usuario?.nombre}
                      </p>
                    </div>
                    <p className="shrink-0 text-[11.5px] text-text-3">{formatoFechaHora.format(new Date(m.fecha))}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
