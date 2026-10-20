import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase/traer-todo";
import { TIPO_MOVIMIENTO_LABEL, motivoLegible } from "@/lib/movimientos";
import { formatoFecha, formatoFechaHora, formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import {
  MOTIVO_INVENTARIO_LABEL,
  type MotivoInventario,
} from "@/app/(app)/inventarios/_components/estado-inventario-badge";
import { MOTIVO_MERMA_LABEL, type MotivoMerma } from "@/app/(app)/mermas/_lib/motivos";
import { inicioDelMes } from "@/lib/fecha";
import {
  calcularCostosQueSubieron,
  calcularMercaderiaInmovilizada,
  calcularProductosPorVencer,
} from "../../_components/dashboard/lib";
import {
  BarRow,
  Badge,
  Card,
  EmptyState,
  Kpi,
  KpiGrid,
  SectionHeader,
  StatRow,
} from "../../_components/dashboard/ui";
import { ReporteHeader } from "../_components/reporte-header";
import { Tabla, Td, Th, Tr } from "../_components/tabla";
import { desdePeriodo, leerPeriodo } from "../_lib/periodo";
import { exigirDueno } from "../_lib/permiso";

// Reporte de productos y stock: la contracara del de caja
// (reorganización pedida por el usuario 2026-10-19). Acá no hay plata
// cobrada: hay mercadería. Qué se vende, qué no se mueve, qué está por
// vencer, cuánto capital hay parado en cada categoría, qué se rompió, qué
// se ajustó y quién tocó los precios.
//
// Las tres primeras tarjetas siguen el período de arriba. Las de auditoría
// (mermas, diferencias de inventario, costos, precios) tienen su propia
// ventana fija de 30 o 7 días, que es la que tiene sentido para revisar, y
// lo dice el título de cada una.

const VENTANA_AUDITORIA_DIAS = 30;
const VENTANA_PRECIOS_DIAS = 7;
const DIAS_INMOVILIZADO = 90;

type SkuInfo = {
  id: string;
  nombre: string;
  stock_minimo: number;
  costo_actual: number | null;
  tipo_presentacion: SkuPresentacion["tipo_presentacion"];
  volumen: number;
  unidad_volumen: string;
  unidades_contenidas: number;
  producto: {
    nombre: string;
    marca: { nombre: string } | null;
    categoria: { nombre: string } | null;
  } | null;
};

type MovimientoReciente = {
  id: string;
  tipo: string;
  cantidad: number;
  fecha: string;
  motivo: string | null;
  sku_id: string;
  usuario: { nombre: string } | null;
  sucursal: { nombre: string } | null;
  sku: { nombre: string; producto: { nombre: string } | null } | null;
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

export default async function ReporteStockPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { periodo: periodoParam } = await searchParams;
  const supabase = await createClient();
  await exigirDueno(supabase);

  const periodo = leerPeriodo(periodoParam);
  const desde = desdePeriodo(periodo);
  // new Date().getTime() y no Date.now(): el lint de React marca Date.now()
  // como función impura dentro del render (react-hooks/purity).
  const ahora = new Date().getTime();
  const cutoffAuditoria = new Date(ahora - VENTANA_AUDITORIA_DIAS * 86_400_000).toISOString();
  const cutoffPrecios = new Date(ahora - VENTANA_PRECIOS_DIAS * 86_400_000).toISOString();
  const inicioMes = inicioDelMes();

  const [
    { data: sucursales },
    { data: skus },
    { data: stock },
    { data: movimientos },
    { data: historial },
    { data: ventasPeriodoRaw },
    { data: mermas30 },
    { data: inventariosCerrados },
    { data: preciosRecientes },
    { data: preciosSucursalRecientes },
    { data: compras },
    { data: recepcionesCompra },
    { data: transferenciasEnTransito },
    { data: pedidosAbiertos },
  ] = await Promise.all([
    traerTodo(
      supabase
        .from("sucursales")
        .select("id, nombre, es_central")
        .eq("activo", true)
        .order("es_central", { ascending: false }),
    ),
    traerTodo(
      supabase
        .from("skus")
        .select(
          `id, nombre, stock_minimo, costo_actual, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           producto:productos ( nombre, marca:marcas ( nombre ), categoria:categorias ( nombre ) )`,
        )
        .eq("activo", true),
    ),
    traerTodo(supabase.from("stock_sucursal").select("sku_id, sucursal_id, cantidad"), [
      "sku_id",
      "sucursal_id",
    ]),
    traerTodo(
      supabase
        .from("movimientos_stock")
        .select(
          `id, tipo, cantidad, fecha, motivo, sku_id,
           usuario:usuarios ( nombre ), sucursal:sucursales ( nombre ),
           sku:skus ( nombre, producto:productos ( nombre ) )`,
        )
        .order("fecha", { ascending: false }),
    ),
    traerTodo(
      supabase
        .from("historial_costos")
        .select("sku_id, costo_unitario, cantidad, fecha, fecha_vencimiento")
        .order("fecha", { ascending: false }),
    ),
    traerTodo(
      supabase
        .from("ventas")
        .select("id, sucursal_id")
        .eq("estado", "confirmada")
        .gte("fecha", desde.toISOString()),
    ),
    traerTodo(supabase.from("mermas").select("cantidad, motivo, sku_id").gte("fecha", cutoffAuditoria)),
    traerTodo(
      supabase.from("inventarios").select("id").eq("estado", "cerrado").gte("fecha_fin", cutoffAuditoria),
    ),
    traerTodo(
      supabase
        .from("precios")
        .select("sku_id, precio_base, actualizado_en, usuario:usuarios ( nombre )")
        .gte("actualizado_en", cutoffPrecios)
        .order("actualizado_en", { ascending: false }),
      "sku_id",
    ),
    traerTodo(
      supabase
        .from("precios_sucursal")
        .select("sku_id, sucursal_id, precio_override, actualizado_en, usuario:usuarios ( nombre )")
        .gte("actualizado_en", cutoffPrecios)
        .order("actualizado_en", { ascending: false }),
      ["sucursal_id", "sku_id"],
    ),
    traerTodo(
      supabase.from("compras").select("id, total, estado, fecha_factura").neq("estado", "borrador"),
    ),
    traerTodo(supabase.from("recepciones_compra").select("compra_id, fecha")),
    traerTodo(supabase.from("transferencias").select("id").eq("estado", "en_transito")),
    traerTodo(supabase.from("pedidos").select("id").not("estado", "in", "(borrador,cerrado)")),
  ]);

  const sucursalesList = (sucursales ?? []) as { id: string; nombre: string; es_central: boolean }[];
  const skusList = (skus ?? []) as unknown as SkuInfo[];
  const skuPorId = new Map(skusList.map((s) => [s.id, s]));
  const sucursalNombrePorId = new Map(sucursalesList.map((s) => [s.id, s.nombre]));
  const sucursalCentral = sucursalesList.find((s) => s.es_central);
  const movimientosList = (movimientos ?? []) as unknown as MovimientoReciente[];

  const nombreSku = (sku: SkuInfo | undefined) => sku?.producto?.nombre ?? sku?.nombre ?? "SKU eliminado";

  // Lo vendido en el período, por SKU: unidades e importe. Los productos
  // particulares (sku_id null) quedan afuera -- no son del catálogo, se
  // miran en el reporte de caja.
  const ventasPeriodo = (ventasPeriodoRaw ?? []) as { id: string; sucursal_id: string }[];
  const idsVentas = ventasPeriodo.map((v) => v.id);
  const { data: itemsRaw } = idsVentas.length
    ? await traerTodoPorLotes<{ sku_id: string | null; cantidad: number; precio_unitario: number }>(
        idsVentas,
        (lote) =>
          supabase.from("venta_items").select("sku_id, cantidad, precio_unitario").in("venta_id", lote),
      )
    : { data: [] };

  const vendidoPorSku = new Map<string, { unidades: number; importe: number }>();
  for (const it of itemsRaw ?? []) {
    if (it.sku_id == null) continue;
    const acum = vendidoPorSku.get(it.sku_id) ?? { unidades: 0, importe: 0 };
    acum.unidades += it.cantidad;
    acum.importe += it.cantidad * Number(it.precio_unitario);
    vendidoPorSku.set(it.sku_id, acum);
  }
  const masVendidos = [...vendidoPorSku.entries()]
    .sort((a, b) => b[1].unidades - a[1].unidades)
    .slice(0, 15);

  // Stock por SKU y por sucursal.
  const stockPorSku = new Map<string, Record<string, number>>();
  for (const fila of (stock ?? []) as { sku_id: string; sucursal_id: string; cantidad: number }[]) {
    const porSucursal = stockPorSku.get(fila.sku_id) ?? {};
    porSucursal[fila.sucursal_id] = fila.cantidad;
    stockPorSku.set(fila.sku_id, porSucursal);
  }

  const stockTotalPorSucursal: Record<string, number> = {};
  const sinStockPorSucursal: Record<string, number> = {};
  const bajoMinimoPorSucursal: Record<string, number> = {};
  for (const s of sucursalesList) {
    stockTotalPorSucursal[s.id] = 0;
    sinStockPorSucursal[s.id] = 0;
    bajoMinimoPorSucursal[s.id] = 0;
  }
  const skusSinStock = new Set<string>();
  for (const sku of skusList) {
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    for (const s of sucursalesList) {
      const cantidad = porSucursal[s.id] ?? 0;
      stockTotalPorSucursal[s.id] += cantidad;
      if (cantidad <= 0) {
        sinStockPorSucursal[s.id] += 1;
        skusSinStock.add(sku.id);
      }
      if (sku.stock_minimo > 0 && cantidad < sku.stock_minimo) bajoMinimoPorSucursal[s.id] += 1;
    }
  }
  const stockTotal = Object.values(stockTotalPorSucursal).reduce((a, b) => a + b, 0);
  const bajoMinimoTotal = Object.values(bajoMinimoPorSucursal).reduce((a, b) => a + b, 0);

  // Mercadería inmovilizada: stock que no se vende (no "sin movimiento" en
  // general -- ver lib.ts). El KPI cuenta la de 90+ días; la tabla muestra
  // todo, ordenado por hace cuánto.
  const ventasParaInmovilizado = movimientosList.filter((m) => m.tipo === "venta");
  const stockTotalPorSkuList = skusList.map((sku) => {
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    return { sku_id: sku.id, stock: Object.values(porSucursal).reduce((a, b) => a + b, 0) };
  });
  const mercaderiaInmovilizada = calcularMercaderiaInmovilizada(
    stockTotalPorSkuList,
    ventasParaInmovilizado,
  );
  const inmovilizados = mercaderiaInmovilizada.filter(
    (p) => p.dias_sin_venta == null || p.dias_sin_venta >= DIAS_INMOVILIZADO,
  );
  const inmovilizadosUnidades = inmovilizados.reduce((acc, p) => acc + p.stock, 0);
  const inmovilizadoValor = inmovilizados.reduce(
    (acc, p) => acc + p.stock * (skuPorId.get(p.sku_id)?.costo_actual ?? 0),
    0,
  );

  // Vencimientos: los lotes de historial_costos no guardan sucursal, así
  // que se estiman contra el stock total de la empresa. Para el dueño es
  // lo correcto: le importa si algo va a vencer, no en qué estante está.
  const stockTotalParaVencimientos = new Map<string, number>(
    stockTotalPorSkuList.map((s) => [s.sku_id, s.stock]),
  );
  const porVencer = calcularProductosPorVencer(
    (historial ?? []) as {
      sku_id: string;
      fecha_vencimiento: string | null;
      fecha: string;
      cantidad: number;
    }[],
    stockTotalParaVencimientos,
  );

  // Capital parado por categoría, a costo de compra (no precio de venta).
  const costoPorCategoria = new Map<string, number>();
  let capitalEnStock = 0;
  for (const sku of skusList) {
    if (sku.costo_actual == null) continue;
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    const total = Object.values(porSucursal).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    const categoria = sku.producto?.categoria?.nombre ?? "Sin categoría";
    const valor = total * sku.costo_actual;
    costoPorCategoria.set(categoria, (costoPorCategoria.get(categoria) ?? 0) + valor);
    capitalEnStock += valor;
  }
  const barsCategorias = [...costoPorCategoria.entries()].sort((a, b) => b[1] - a[1]);
  const maxCategoria = barsCategorias[0]?.[1] ?? 0;

  const costosSubieron = calcularCostosQueSubieron(
    (historial ?? []) as { sku_id: string; costo_unitario: number | null; fecha: string }[],
  );

  // Mermas por motivo: se carga a mano y es justo donde se puede esconder
  // un faltante, así que el dueño tiene que verla sin ir a buscarla.
  const porMotivoMerma = new Map<string, { unidades: number; valor: number }>();
  for (const merma of (mermas30 ?? []) as {
    cantidad: number;
    motivo: MotivoMerma;
    sku_id: string;
  }[]) {
    const acum = porMotivoMerma.get(merma.motivo) ?? { unidades: 0, valor: 0 };
    acum.unidades += merma.cantidad;
    // Valuada al costo actual: aproximación suficiente para dimensionar la
    // pérdida (el costo pudo cambiar desde que se rompió).
    acum.valor += merma.cantidad * (skuPorId.get(merma.sku_id)?.costo_actual ?? 0);
    porMotivoMerma.set(merma.motivo, acum);
  }
  const barsMermas = [...porMotivoMerma.entries()].sort((a, b) => b[1].unidades - a[1].unidades);
  const maxMerma = barsMermas[0]?.[1].unidades ?? 0;
  const mermaUnidades = barsMermas.reduce((acc, [, d]) => acc + d.unidades, 0);
  const mermaValor = barsMermas.reduce((acc, [, d]) => acc + d.valor, 0);

  // Diferencias de inventario por motivo.
  const idsInventarios = (inventariosCerrados ?? []).map((i) => i.id);
  const { data: itemsConDiferencia } = idsInventarios.length
    ? await traerTodoPorLotes<{ motivo: MotivoInventario | null; diferencia: number }>(
        idsInventarios,
        (lote) =>
          supabase
            .from("inventario_items")
            .select("motivo, diferencia")
            .in("inventario_id", lote)
            .neq("diferencia", 0),
      )
    : { data: [] };

  const porMotivoInventario = new Map<string, { count: number; unidades: number }>();
  for (const item of itemsConDiferencia ?? []) {
    const motivo = item.motivo ?? "desconocido";
    const acum = porMotivoInventario.get(motivo) ?? { count: 0, unidades: 0 };
    acum.count += 1;
    acum.unidades += Math.abs(item.diferencia);
    porMotivoInventario.set(motivo, acum);
  }
  const barsMotivos = [...porMotivoInventario.entries()].sort(
    (a, b) => b[1].unidades - a[1].unidades,
  );
  const maxMotivo = barsMotivos[0]?.[1].unidades ?? 0;

  // Precios cargados: control detectivo (CLAUDE.md) -- el encargado de
  // Olavarría carga precios sin aprobación previa y esto es lo que
  // reemplaza esa aprobación.
  const margenPct = (precio: number, costo: number | null) =>
    costo == null || precio <= 0 ? null : ((precio - costo) / precio) * 100;

  const preciosCargados: PrecioCargado[] = [
    ...((preciosRecientes ?? []) as unknown as {
      sku_id: string;
      precio_base: number;
      actualizado_en: string;
      usuario: { nombre: string } | null;
    }[]).map((p) => {
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
    ...((preciosSucursalRecientes ?? []) as unknown as {
      sku_id: string;
      sucursal_id: string;
      precio_override: number;
      actualizado_en: string;
      usuario: { nombre: string } | null;
    }[]).map((p) => {
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

  // Compras del mes: confirmadas + cerradas cuya fecha efectiva cae en el
  // mes en curso. fecha_factura manda cuando está cargada; si no, la fecha
  // de la primera recepción (siempre tiene valor).
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

  const movimientosRecientes = movimientosList.slice(0, 12);

  return (
    <div className="flex flex-col gap-6">
      <ReporteHeader
        titulo="Productos y stock"
        bajada="Qué se vende y qué no se mueve, qué está por vencer, cuánta plata hay parada en mercadería, y toda la auditoría de costos, mermas y precios."
        base="/reportes/stock"
        periodo={periodo}
      />

      <KpiGrid>
        <Kpi
          label="Stock total (unidades)"
          value={stockTotal}
          sub={sucursalesList.map((s) => `${s.nombre} ${stockTotalPorSucursal[s.id] ?? 0}`).join(" · ")}
        />
        <Kpi
          label="Plata parada en stock"
          value={formatoMoneda.format(capitalEnStock)}
          sub="A costo de compra"
        />
        <Kpi
          label="Productos sin stock"
          value={skusSinStock.size}
          sub={`${bajoMinimoTotal} bajo mínimo`}
        />
        <Kpi
          label="Mercadería inmovilizada"
          value={inmovilizados.length}
          sub={`${inmovilizadosUnidades} u. · ${formatoMoneda.format(inmovilizadoValor)} · ${DIAS_INMOVILIZADO}+ días sin venderse`}
        />
      </KpiGrid>

      <div>
        <SectionHeader title="Más vendidos" meta="Del período elegido, las dos sucursales juntas" />
        <Card title={`Top ${masVendidos.length} por unidades`}>
          {masVendidos.length === 0 ? (
            <EmptyState
              title="Sin ventas en el período"
              sub="Todavía no hay ventas confirmadas en este rango."
            />
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th align="right">#</Th>
                  <Th>Producto</Th>
                  <Th>Presentación</Th>
                  <Th align="right">Unidades</Th>
                  <Th align="right">Importe</Th>
                </tr>
              </thead>
              <tbody>
                {masVendidos.map(([skuId, datos], i) => {
                  const sku = skuPorId.get(skuId);
                  return (
                    <Tr key={skuId}>
                      <Td align="right" numero mute>
                        {i + 1}
                      </Td>
                      <Td>
                        <span className="font-medium text-text">{nombreSku(sku)}</span>
                        {sku?.producto?.marca?.nombre && (
                          <span className="text-text-3"> · {sku.producto.marca.nombre}</span>
                        )}
                      </Td>
                      <Td mute>{sku ? presentacionLabel(sku) : "—"}</Td>
                      <Td align="right" numero>
                        {datos.unidades}
                      </Td>
                      <Td align="right" numero>
                        {formatoMoneda.format(datos.importe)}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Tabla>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader title="Stock por sucursal" />
        <Card title="Unidades, faltantes y mínimos">
          <Tabla>
            <thead>
              <tr>
                <Th>Sucursal</Th>
                <Th align="right">Unidades</Th>
                <Th align="right">Sin stock</Th>
                <Th align="right">Bajo mínimo</Th>
              </tr>
            </thead>
            <tbody>
              {sucursalesList.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <span className="font-medium text-text">{s.nombre}</span>
                  </Td>
                  <Td align="right" numero>
                    {stockTotalPorSucursal[s.id] ?? 0}
                  </Td>
                  <Td align="right" numero>
                    {sinStockPorSucursal[s.id] ?? 0}
                  </Td>
                  <Td align="right" numero>
                    {bajoMinimoPorSucursal[s.id] ?? 0}
                  </Td>
                </Tr>
              ))}
              <Tr total>
                <Td>Total</Td>
                <Td align="right" numero>
                  {stockTotal}
                </Td>
                <Td align="right" numero>
                  {skusSinStock.size}
                </Td>
                <Td align="right" numero>
                  {bajoMinimoTotal}
                </Td>
              </Tr>
            </tbody>
          </Tabla>
        </Card>
      </div>

      <div>
        <SectionHeader title="Próximos a vencer" meta="30 días, stock de las dos sucursales" />
        <Card title={`${porVencer.length} lote${porVencer.length === 1 ? "" : "s"}`}>
          {porVencer.length === 0 ? (
            <EmptyState title="Sin vencimientos" sub="Nada vence en los próximos 30 días." />
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th>Vence</Th>
                  <Th align="right">Unidades</Th>
                  <Th align="right">Falta</Th>
                </tr>
              </thead>
              <tbody>
                {porVencer.map((v) => (
                  <Tr key={`${v.sku_id}:${v.fecha_vencimiento}`}>
                    <Td>
                      <span className="font-medium text-text">{nombreSku(skuPorId.get(v.sku_id))}</span>
                    </Td>
                    <Td>{formatoFecha.format(new Date(`${v.fecha_vencimiento}T12:00:00`))}</Td>
                    <Td align="right" numero>
                      {v.unidades}
                    </Td>
                    <Td align="right">
                      <Badge
                        color={v.dias_restantes < 0 ? "err" : v.dias_restantes <= 7 ? "warn" : "info"}
                      >
                        {v.dias_restantes < 0
                          ? "Vencido"
                          : v.dias_restantes === 0
                            ? "Hoy"
                            : `${v.dias_restantes} d.`}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Mercadería inmovilizada"
          meta="Ordenada por hace cuánto no se vende"
        />
        <Card title={`${mercaderiaInmovilizada.length} productos con stock`}>
          {mercaderiaInmovilizada.length === 0 ? (
            <EmptyState
              title="Sin productos inmovilizados"
              sub="Todo el stock activo tuvo ventas recientes."
            />
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th align="right">Stock</Th>
                  <Th>Última venta</Th>
                  <Th align="right">Sin venderse</Th>
                  <Th align="right">A costo</Th>
                </tr>
              </thead>
              <tbody>
                {mercaderiaInmovilizada.map((p) => {
                  const sku = skuPorId.get(p.sku_id);
                  return (
                    <Tr key={p.sku_id}>
                      <Td>
                        <span className="font-medium text-text">{nombreSku(sku)}</span>
                        {sku && <span className="text-text-3"> · {presentacionLabel(sku)}</span>}
                      </Td>
                      <Td align="right" numero>
                        {p.stock}
                      </Td>
                      <Td mute>
                        {p.ultima_venta
                          ? formatoFecha.format(new Date(p.ultima_venta))
                          : "Nunca se vendió"}
                      </Td>
                      <Td align="right" numero>
                        {p.dias_sin_venta == null ? "—" : `${p.dias_sin_venta} d.`}
                      </Td>
                      <Td align="right" numero>
                        {formatoMoneda.format(p.stock * (sku?.costo_actual ?? 0))}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Tabla>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader title="Auditoría y costos" meta="Solo vos ves esta sección" />

        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[1.55fr_1fr]">
          <Card title="Dónde está la plata · a costo de compra">
            {barsCategorias.length === 0 ? (
              <EmptyState
                title="Todavía no hay costos cargados"
                sub="Se completa a medida que se reciben compras y se carga el costo de cada SKU."
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
                  Costo de compra (costo actual × stock), no precio de venta.
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
              <StatRow
                label="Transferencias en tránsito"
                value={(transferenciasEnTransito ?? []).length}
              />
              <StatRow
                label={`Costos que subieron · ${VENTANA_AUDITORIA_DIAS} días`}
                value={costosSubieron.length}
                sub={costosSubieron.length > 0 ? "Revisar precios de venta" : undefined}
              />
            </div>
          </Card>
        </div>

        <div className="mt-[14px] grid grid-cols-1 gap-[14px] lg:grid-cols-2">
          <Card title={`Diferencias de inventario por motivo · ${VENTANA_AUDITORIA_DIAS} días`}>
            {barsMotivos.length === 0 ? (
              <EmptyState
                title="Sin diferencias en el período"
                sub="Los inventarios cerrados no encontraron faltantes ni sobrantes."
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

          <Card title={`Mermas por motivo · ${VENTANA_AUDITORIA_DIAS} días`}>
            {barsMermas.length === 0 ? (
              <EmptyState
                title="Sin mermas registradas"
                sub="Acá aparece lo que se rompió, se venció o se consumió adentro del local."
              />
            ) : (
              <div className="flex flex-col gap-[9px] p-[14px]">
                {barsMermas.map(([motivo, datos]) => (
                  <BarRow
                    key={motivo}
                    tone="loss"
                    label={MOTIVO_MERMA_LABEL[motivo as MotivoMerma] ?? motivo}
                    value={datos.unidades}
                    max={maxMerma}
                    display={`${datos.unidades} u. · ${formatoMoneda.format(datos.valor)}`}
                  />
                ))}
                <p className="mt-[3px] border-t border-border pt-[8px] text-[12.5px] text-text-2">
                  Total: <b className="font-medium tabular-nums text-text">{mermaUnidades} unidades</b>{" "}
                  · {formatoMoneda.format(mermaValor)} a costo.{" "}
                  <Link href="/mermas" className="font-medium text-moe hover:underline">
                    Ver el detalle
                  </Link>
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="mt-[14px]">
          <Card title={`Precios cargados · ${VENTANA_PRECIOS_DIAS} días`}>
            {preciosCargados.length === 0 ? (
              <EmptyState
                title="Sin precios cargados"
                sub="Control detectivo: acá aparece quién cargó cada precio, para revisar sin tener que aprobar antes."
              />
            ) : (
              <Tabla>
                <thead>
                  <tr>
                    <Th>Cuándo</Th>
                    <Th>Producto</Th>
                    <Th>Sucursal</Th>
                    <Th>Quién</Th>
                    <Th align="right">Precio</Th>
                    <Th align="right">Margen</Th>
                  </tr>
                </thead>
                <tbody>
                  {preciosCargados.slice(0, 25).map((p) => (
                    <Tr key={p.key}>
                      <Td mute>{formatoFechaHora.format(new Date(p.actualizadoEn))}</Td>
                      <Td>
                        <span className="font-medium text-text">
                          {nombreSku(skuPorId.get(p.skuId))}
                        </span>
                      </Td>
                      <Td>
                        {p.sucursalNombre}
                        {p.tipo === "excepción" && (
                          <span className="text-text-3"> · excepción manual</span>
                        )}
                      </Td>
                      <Td>{p.usuarioNombre}</Td>
                      <Td align="right" numero>
                        {formatoMoneda.format(p.precio)}
                      </Td>
                      <Td align="right" numero>
                        {p.margenPct == null ? (
                          "—"
                        ) : (
                          <span className={p.margenPct < 10 ? "text-warn" : undefined}>
                            {p.margenPct.toFixed(0)}%
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </Card>
        </div>

        <div className="mt-[14px]">
          <Card title="Últimos movimientos del sistema">
            {movimientosRecientes.length === 0 ? (
              <EmptyState
                title="Todavía no hay movimientos"
                sub="Van a aparecer acá a medida que se opere el sistema."
              />
            ) : (
              <Tabla>
                <thead>
                  <tr>
                    <Th>Cuándo</Th>
                    <Th>Movimiento</Th>
                    <Th>Producto</Th>
                    <Th>Sucursal</Th>
                    <Th>Quién</Th>
                    <Th align="right">Cantidad</Th>
                  </tr>
                </thead>
                <tbody>
                  {movimientosRecientes.map((m) => (
                    <Tr key={m.id}>
                      <Td mute>{formatoFechaHora.format(new Date(m.fecha))}</Td>
                      <Td>
                        <span className="font-medium text-text">
                          {TIPO_MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}
                        </span>
                        {motivoLegible(m.motivo, m.tipo) && (
                          <span className="text-text-3"> · {motivoLegible(m.motivo, m.tipo)}</span>
                        )}
                      </Td>
                      <Td>{m.sku?.producto?.nombre ?? m.sku?.nombre ?? "—"}</Td>
                      <Td>{m.sucursal?.nombre ?? "—"}</Td>
                      <Td>{m.usuario?.nombre ?? "—"}</Td>
                      <Td align="right" numero>
                        {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
