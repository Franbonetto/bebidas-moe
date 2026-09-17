import { createClient } from "@/lib/supabase/server";
import {
  MOTIVO_INVENTARIO_LABEL,
  type MotivoInventario,
} from "@/app/(app)/inventarios/_components/estado-inventario-badge";
import { TIPO_MOVIMIENTO_LABEL, motivoLegible } from "@/lib/movimientos";
import { formatoFechaHora, formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { calcularCostosQueSubieron } from "./lib";
import { AutoRefresh } from "../auto-refresh";
import {
  AlertRow,
  BarRow,
  Card,
  EmptyState,
  Kpi,
  KpiGrid,
  SectionHeader,
  StatRow,
} from "./ui";

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
  producto: { nombre: string; categoria: { nombre: string } | null } | null;
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

export async function DuenoDashboard() {
  const supabase = await createClient();

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const ahora = new Date().getTime();
  const cutoff30 = new Date(ahora - 30 * 86_400_000).toISOString();
  const cutoff7 = new Date(ahora - 7 * 86_400_000).toISOString();
  const cutoffInmovilizado = ahora - 90 * 86_400_000;
  const hoy = new Date().toISOString().slice(0, 10);

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
  ] = await Promise.all([
    supabase.from("sucursales").select("id, nombre, es_central").eq("activo", true).order("es_central", { ascending: false }),
    supabase
      .from("skus")
      .select(
        `id, nombre, stock_minimo, costo_actual, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, categoria:categorias ( nombre ) )`,
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
    supabase.from("historial_costos").select("sku_id, costo_unitario, fecha").order("fecha", { ascending: false }),
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
  ]);

  const sucursalesList = (sucursales ?? []) as Sucursal[];
  const skusList = (skus ?? []) as unknown as SkuInfo[];
  const movimientosList = (movimientos ?? []) as unknown as (MovimientoReciente & { sku_id: string })[];

  const skuPorId = new Map(skusList.map((s) => [s.id, s]));
  const sucursalNombrePorId = new Map(sucursalesList.map((s) => [s.id, s.nombre]));
  const sucursalCentral = sucursalesList.find((s) => s.es_central);

  // Caja del día por sucursal, para el panel "Caja del día" (lado a lado
  // Olavarría/Laprida) del Inicio.
  type CajaFila = {
    sucursal_id: string;
    estado: "abierta" | "cerrada";
    monto_apertura: number;
    cantidad_tickets: number | null;
    ventas: { total: number }[];
  };
  const cajaPorSucursal = new Map(
    ((cajasHoy ?? []) as unknown as CajaFila[]).map((c) => [
      c.sucursal_id,
      {
        estado: c.estado,
        montoApertura: c.monto_apertura,
        totalVendido: c.ventas.reduce((acc, v) => acc + v.total, 0),
        cantidadTickets: c.cantidad_tickets ?? c.ventas.length,
      },
    ]),
  );

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
  const skusBajoMinimo = new Set<string>();
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
        skusBajoMinimo.add(sku.id);
      }
    }
  }

  // Inmovilizado: SKU con stock hoy cuyo último movimiento tiene 90+ días.
  // Se deriva de movimientos_stock (mismo criterio que sugerir_conteo_puntual
  // en el bloque 8: no hay flag aparte, se lee del historial real).
  const ultimoMovimientoPorSku = new Map<string, string>();
  for (const fila of movimientosList) {
    if (!ultimoMovimientoPorSku.has(fila.sku_id)) ultimoMovimientoPorSku.set(fila.sku_id, fila.fecha);
  }
  let inmovilizadosCount = 0;
  let inmovilizadosUnidades = 0;
  for (const sku of skusList) {
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    const total = Object.values(porSucursal).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    const ultimo = ultimoMovimientoPorSku.get(sku.id);
    if (!ultimo || new Date(ultimo).getTime() < cutoffInmovilizado) {
      inmovilizadosCount += 1;
      inmovilizadosUnidades += total;
    }
  }

  // Stock a costo de compra, por categoría (no es precio de venta: el
  // módulo de precios todavía no existe).
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

  // "Compras del mes": confirmadas + cerradas cuya fecha efectiva cae en el
  // mes en curso. fecha_factura manda cuando está cargada; si no, se usa la
  // fecha de la primera recepción (siempre tiene valor, es default now()).
  // Una compra confirmada que todavía no tiene ni factura ni recepción no
  // se puede ubicar en el tiempo con los datos actuales, así que queda
  // afuera del total (no se inventa una fecha).
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

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh />
      <div>
        <SectionHeader title="Hoy" />
        <KpiGrid>
          <Kpi
            label="Stock total (unidades)"
            value={stockTotal}
            sub={sucursalesList
              .map((s) => `${s.nombre} ${stockTotalPorSucursal[s.id] ?? 0}`)
              .join(" · ")}
          />
          <Kpi
            label="Productos sin stock"
            value={skusSinStock.size}
            sub={sucursalesList.map((s) => `${s.nombre} ${sinStockPorSucursal[s.id] ?? 0}`).join(" · ")}
          />
          <Kpi
            label="Mercadería inmovilizada"
            value={inmovilizadosCount}
            sub={`${inmovilizadosUnidades} unidades sin movimiento hace 90+ días`}
          />
        </KpiGrid>

        <div className="mt-3 grid grid-cols-1 gap-[14px] sm:grid-cols-2">
          {sucursalesList.map((s) => {
            const caja = cajaPorSucursal.get(s.id);
            const bajoMinimo = bajoMinimoPorSucursal[s.id] ?? 0;
            return (
              <div key={s.id} className="rounded-card border border-border bg-bg p-[15px]">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-text">Caja del día · {s.nombre}</h3>
                  <span
                    className={`rounded-[5px] px-[7px] py-[2px] text-[11px] font-medium ${
                      caja?.estado === "abierta"
                        ? "bg-ok-bg text-ok"
                        : caja?.estado === "cerrada"
                          ? "bg-bg-2 text-text-2"
                          : "bg-warn-bg text-warn"
                    }`}
                  >
                    {caja ? (caja.estado === "abierta" ? "Abierta" : "Cerrada") : "Sin abrir"}
                  </span>
                </div>

                {caja ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12px] text-text-2">Vendido hoy</span>
                      <span className="text-[20px] font-semibold tabular-nums text-text">
                        {formatoMoneda.format(caja.totalVendido)}
                      </span>
                    </div>
                    <p className="mt-[3px] text-[12px] text-text-3">
                      {caja.cantidadTickets} ticket{caja.cantidadTickets === 1 ? "" : "s"} · apertura{" "}
                      {formatoMoneda.format(caja.montoApertura)}
                    </p>
                  </>
                ) : (
                  <p className="text-[12.5px] text-text-3">Todavía no se abrió la caja hoy.</p>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-border pt-[9px] text-[12.5px]">
                  <span className="text-text-2">Productos bajo mínimo</span>
                  <span className={`font-medium tabular-nums ${bajoMinimo > 0 ? "text-warn" : "text-text-2"}`}>
                    {bajoMinimo}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

        <Card title="Necesita atención">
          <div className="flex flex-col gap-[8px] p-[10px]">
            {skusBajoMinimo.size === 0 &&
            skusSinStock.size === 0 &&
            (transferenciasEnTransito ?? []).length === 0 &&
            costosSubieron.length === 0 ? (
              <EmptyState title="Todo al día" sub="No hay alertas activas en este momento." />
            ) : (
              <>
                {skusSinStock.size > 0 && (
                  <AlertRow
                    color="err"
                    title={`${skusSinStock.size} producto${skusSinStock.size === 1 ? "" : "s"} sin stock`}
                    sub={sucursalesList.map((s) => `${s.nombre} ${sinStockPorSucursal[s.id] ?? 0}`).join(" · ")}
                  />
                )}
                {skusBajoMinimo.size > 0 && (
                  <AlertRow
                    color="warn"
                    title={`${skusBajoMinimo.size} producto${skusBajoMinimo.size === 1 ? "" : "s"} bajo el mínimo`}
                    sub="Revisar antes del pedido semanal"
                  />
                )}
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
                    sub="Últimos 30 días"
                  />
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
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

      <Card title="Precios cargados · últimos 7 días">
        {preciosCargados.length === 0 ? (
          <EmptyState
            title="Sin precios cargados en los últimos 7 días"
            sub="Control detectivo: acá aparece quién cargó cada precio, para revisar sin tener que aprobar antes."
          />
        ) : (
          <>
            {/* Celular: tarjetas apiladas en vez de comprimir la tabla
                (docs/identidad-visual.md: "las tablas complejas se
                adaptan, no se comprimen"). */}
            <div className="flex flex-col divide-y divide-[#F1F1F3] sm:hidden">
              {preciosCargados.map((p) => {
                const sku = skuPorId.get(p.skuId);
                return (
                  <div key={p.key} className="flex flex-col gap-[3px] px-[14px] py-[10px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate font-medium text-text">
                        {sku?.producto?.nombre ?? sku?.nombre ?? "—"}
                      </p>
                      <p className="shrink-0 tabular-nums text-text">{formatoMoneda.format(p.precio)}</p>
                    </div>
                    <p className="text-[11.5px] text-text-3">
                      {sku ? presentacionLabel(sku) : ""}
                      {p.tipo === "excepción" ? " · excepción manual" : ""}
                    </p>
                    <p className="text-[11.5px] text-text-3">
                      {p.sucursalNombre} · Margen {p.margenPct == null ? "—" : `${p.margenPct.toFixed(0)}%`}
                    </p>
                    <p className="text-[11.5px] text-text-3">
                      {p.usuarioNombre} · {formatoFechaHora.format(new Date(p.actualizadoEn))}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Producto
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Sucursal
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Precio
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Margen
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Cargado por
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Cuándo
                  </th>
                </tr>
              </thead>
              <tbody>
                {preciosCargados.map((p) => {
                  const sku = skuPorId.get(p.skuId);
                  return (
                    <tr key={p.key} className="border-b border-[#F1F1F3] last:border-b-0">
                      <td className="px-[14px] py-[9px] align-middle">
                        <p className="font-medium text-text">{sku?.producto?.nombre ?? sku?.nombre ?? "—"}</p>
                        <p className="text-[11.5px] text-text-3">
                          {sku ? presentacionLabel(sku) : ""}
                          {p.tipo === "excepción" ? " · excepción manual" : ""}
                        </p>
                      </td>
                      <td className="px-[14px] py-[9px] align-middle text-text-2">{p.sucursalNombre}</td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text">
                        {formatoMoneda.format(p.precio)}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {p.margenPct == null ? "—" : `${p.margenPct.toFixed(0)}%`}
                      </td>
                      <td className="px-[14px] py-[9px] align-middle text-text-2">{p.usuarioNombre}</td>
                      <td className="px-[14px] py-[9px] text-right align-middle text-text-3">
                        {formatoFechaHora.format(new Date(p.actualizadoEn))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      <Card title="Últimos movimientos del sistema">
        {movimientosRecientes.length === 0 ? (
          <EmptyState title="Todavía no hay movimientos" sub="Van a aparecer acá a medida que se opere el sistema." />
        ) : (
          <>
            <div className="flex flex-col divide-y divide-[#F1F1F3] sm:hidden">
              {movimientosRecientes.map((m) => (
                <div key={m.id} className="flex flex-col gap-[3px] px-[14px] py-[10px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium text-text">{TIPO_MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}</p>
                    <p className="shrink-0 text-[11.5px] text-text-3">
                      {formatoFechaHora.format(new Date(m.fecha))}
                    </p>
                  </div>
                  <p className="text-[11.5px] text-text-3">
                    {m.sku?.producto?.nombre ?? m.sku?.nombre}
                    {" · "}
                    {m.cantidad > 0 ? "+" : ""}
                    {m.cantidad}
                    {motivoLegible(m.motivo, m.tipo) ? ` — ${motivoLegible(m.motivo, m.tipo)}` : ""}
                  </p>
                  <p className="text-[11.5px] text-text-3">
                    {m.sucursal?.nombre} · {m.usuario?.nombre}
                  </p>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Movimiento
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Sucursal
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Usuario
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Cuándo
                  </th>
                </tr>
              </thead>
              <tbody>
                {movimientosRecientes.map((m) => (
                  <tr key={m.id} className="border-b border-[#F1F1F3] last:border-b-0">
                    <td className="px-[14px] py-[9px] align-middle">
                      <p className="font-medium text-text">{TIPO_MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}</p>
                      <p className="text-[11.5px] text-text-3">
                        {m.sku?.producto?.nombre ?? m.sku?.nombre}
                        {" · "}
                        {m.cantidad > 0 ? "+" : ""}
                        {m.cantidad}
                        {motivoLegible(m.motivo, m.tipo) ? ` — ${motivoLegible(m.motivo, m.tipo)}` : ""}
                      </p>
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text-2">{m.sucursal?.nombre}</td>
                    <td className="px-[14px] py-[9px] align-middle text-text-2">{m.usuario?.nombre}</td>
                    <td className="px-[14px] py-[9px] text-right align-middle text-text-3">
                      {formatoFechaHora.format(new Date(m.fecha))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
