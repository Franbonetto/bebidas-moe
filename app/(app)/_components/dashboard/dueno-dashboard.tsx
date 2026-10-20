import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { ZONA_ARGENTINA, fechaOperativa, horaArgentina, inicioDelDia } from "@/lib/fecha";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { AutoRefresh } from "../auto-refresh";
import { AlertRow, Card, EmptyState, Kpi, KpiGrid, QuickAction, QuickActions, SectionHeader } from "./ui";

// Inicio del dueño: el estado de hoy y nada más.
//
// Hasta el 2026-10-19 esta pantalla era todo el panel -- ventas del día, de
// la semana y del mes, más vendidos, stock, vencimientos, mermas,
// diferencias de inventario, precios cargados, particulares y los últimos
// movimientos, las dos sucursales, todo en una sola página. Era
// información buena mal ordenada: para encontrar un dato había que
// recorrer la pantalla entera.
//
// Ahora el inicio contesta una sola pregunta -- "¿cómo viene el día y hay
// algo que necesite que yo haga?" -- y todo lo que es analizar vive en
// Reportes (Caja y dinero / Productos y stock / Alertas / Balance de IVA).
// De paso, el inicio dejó de leer movimientos_stock e historial_costos
// enteros, que es lo que lo hacía lento en el celular.

// Saludo según la hora de Argentina, no la del servidor (que corre en UTC
// y a las 20:00 de acá ya cree que son las 23). Los cortes son los de acá:
// hasta las 13 es "buen día", el local abre a la mañana y cierra a las 22.
function saludo(hora: number): string {
  if (hora < 6) return "Buenas noches";
  if (hora < 13) return "Buen día";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

const formatoDiaLargo = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: ZONA_ARGENTINA,
});

type Sucursal = { id: string; nombre: string };

type CajaFila = {
  sucursal_id: string;
  estado: "abierta" | "cerrada";
  cantidad_tickets: number | null;
};

type PedidoCompraReciente = {
  id: string;
  numero: string;
  creador: { nombre: string } | null;
  pedidos_compra_items: { id: string }[];
};

export async function DuenoDashboard({ nombre }: { nombre: string }) {
  const supabase = await createClient();

  const ahora = new Date();
  // Solo el primer nombre: en el saludo "Buen día, Lucas" suena como lo
  // diría alguien del local, y `usuarios.nombre` puede traer el apellido.
  const primerNombre = nombre.trim().split(/\s+/)[0] ?? "";
  const diaLargo = formatoDiaLargo.format(ahora);

  const hoy = fechaOperativa();
  const inicioHoy = inicioDelDia();

  const [
    { data: sucursales },
    { data: cajasHoy },
    { data: ventasHoy },
    { data: skus },
    { data: stock },
    { data: transferenciasEnTransito },
    { data: pedidoCompraReciente },
  ] = await Promise.all([
    traerTodo(
      supabase
        .from("sucursales")
        .select("id, nombre")
        .eq("activo", true)
        .order("es_central", { ascending: false }),
    ),
    traerTodo(
      supabase.from("cajas").select("sucursal_id, estado, cantidad_tickets").eq("fecha", hoy),
      ["sucursal_id", "fecha"],
    ),
    traerTodo(
      supabase
        .from("ventas")
        .select("sucursal_id, total")
        .eq("estado", "confirmada")
        .gte("fecha", inicioHoy.toISOString()),
    ),
    traerTodo(supabase.from("skus").select("id, stock_minimo").eq("activo", true)),
    traerTodo(supabase.from("stock_sucursal").select("sku_id, sucursal_id, cantidad"), [
      "sku_id",
      "sucursal_id",
    ]),
    traerTodo(supabase.from("transferencias").select("id").eq("estado", "en_transito")),
    // "Pedido de la semana": lo que la encargada de Olavarría arma para que
    // el dueño sepa qué pedirle a cada proveedor (pedidos_compra). No
    // confundir con "pedidos" (el flujo interno Laprida -> Olavarría) ni
    // con "compras" (lo que ya llegó).
    supabase
      .from("pedidos_compra")
      .select(
        `id, numero, estado, fecha_creacion,
         creador:usuarios!pedidos_compra_usuario_creador_id_fkey ( nombre ),
         pedidos_compra_items ( id )`,
      )
      .eq("estado", "pendiente")
      .order("fecha_creacion", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sucursalesList = (sucursales ?? []) as Sucursal[];
  const cajas = (cajasHoy ?? []) as unknown as CajaFila[];
  const ventas = (ventasHoy ?? []) as { sucursal_id: string; total: number }[];
  const skusList = (skus ?? []) as { id: string; stock_minimo: number }[];
  const stockList = (stock ?? []) as { sku_id: string; sucursal_id: string; cantidad: number }[];
  const pedidoCompra = pedidoCompraReciente as unknown as PedidoCompraReciente | null;

  const cajaPorSucursal = new Map(cajas.map((c) => [c.sucursal_id, c]));

  const porSucursal = sucursalesList.map((s) => {
    const suyas = ventas.filter((v) => v.sucursal_id === s.id);
    return {
      ...s,
      caja: cajaPorSucursal.get(s.id),
      vendido: suyas.reduce((acc, v) => acc + Number(v.total), 0),
      tickets: suyas.length,
    };
  });

  const vendidoHoy = ventas.reduce((acc, v) => acc + Number(v.total), 0);
  const ticketsHoy = ventas.length;
  const ticketPromedio = ticketsHoy > 0 ? vendidoHoy / ticketsHoy : 0;

  // Sin stock y bajo mínimo: se cuentan sobre el stock de cada sucursal, no
  // sobre el total de la empresa -- un SKU que está en cero en Laprida es
  // un faltante aunque Olavarría tenga el depósito lleno.
  const stockPorSku = new Map<string, Record<string, number>>();
  for (const fila of stockList) {
    const porSucursal = stockPorSku.get(fila.sku_id) ?? {};
    porSucursal[fila.sucursal_id] = fila.cantidad;
    stockPorSku.set(fila.sku_id, porSucursal);
  }
  const skusSinStock = new Set<string>();
  let bajoMinimo = 0;
  for (const sku of skusList) {
    const porSucursal = stockPorSku.get(sku.id) ?? {};
    for (const s of sucursalesList) {
      const cantidad = porSucursal[s.id] ?? 0;
      if (cantidad <= 0) skusSinStock.add(sku.id);
      if (sku.stock_minimo > 0 && cantidad < sku.stock_minimo) bajoMinimo += 1;
    }
  }

  const enTransito = (transferenciasEnTransito ?? []).length;
  const sinAbrir = porSucursal.filter((s) => !s.caja);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />

      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-text">
          {saludo(horaArgentina(ahora))}
          {primerNombre ? `, ${primerNombre}` : ""}
        </h1>
        <p className="mt-[2px] text-[12.5px] text-text-3">
          {diaLargo.charAt(0).toUpperCase() + diaLargo.slice(1)}
        </p>
      </div>

      <Link
        href={pedidoCompra ? `/pedidos/compra/${pedidoCompra.id}` : "/pedidos"}
        className="flex items-center justify-between gap-3 rounded-card border border-border bg-bg px-[14px] py-[10px] hover:border-border-strong hover:bg-[#FAFAFB]"
      >
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text">
            Pedido de la semana{pedidoCompra?.creador?.nombre ? ` · ${pedidoCompra.creador.nombre}` : ""}
          </p>
          <p className="text-[11.5px] text-text-3">
            {pedidoCompra
              ? `${pedidoCompra.numero} · ${pedidoCompra.pedidos_compra_items.length} producto${pedidoCompra.pedidos_compra_items.length === 1 ? "" : "s"} para pedirle a los proveedores`
              : "Sin pedido de compra pendiente"}
          </p>
        </div>
        <span className="shrink-0 text-[12px] font-medium text-moe">Ver detalle →</span>
      </Link>

      <div>
        <SectionHeader title="Hoy" meta="Las dos sucursales juntas" />
        <KpiGrid>
          <Kpi label="Vendido hoy" value={formatoMoneda.format(vendidoHoy)} />
          <Kpi label="Tickets" value={ticketsHoy} />
          <Kpi label="Ticket promedio" value={formatoMoneda.format(ticketPromedio)} />
          <Kpi
            label="Productos sin stock"
            value={skusSinStock.size}
            sub={`${bajoMinimo} bajo mínimo`}
          />
        </KpiGrid>
      </div>

      <div>
        <SectionHeader title="Caja de hoy" />
        <Card
          title="Por sucursal"
          action={
            <Link href="/reportes/caja" className="whitespace-nowrap text-[12.5px] font-medium text-moe hover:underline">
              Ver el reporte →
            </Link>
          }
        >
          {porSucursal.length === 0 ? (
            <EmptyState title="Sin sucursales activas" sub="No hay ninguna sucursal para mostrar." />
          ) : (
            <div className="flex flex-col divide-y divide-[#F1F1F3]">
              {porSucursal.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-[14px] py-[11px]">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-text">{s.nombre}</p>
                    <p className="text-[11.5px] text-text-3">
                      {s.tickets} ticket{s.tickets === 1 ? "" : "s"} hoy
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-[5px] px-[7px] py-[2px] text-[11px] font-medium ${
                        s.caja?.estado === "abierta" ? "bg-ok-bg text-ok" : "bg-bg-2 text-text-2"
                      }`}
                    >
                      Caja {s.caja ? (s.caja.estado === "abierta" ? "abierta" : "cerrada") : "sin abrir"}
                    </span>
                    <span className="text-[14px] font-medium tabular-nums text-text">
                      {formatoMoneda.format(s.vendido)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {(enTransito > 0 || sinAbrir.length > 0) && (
        <div>
          <SectionHeader title="Para mirar" meta="Lo urgente del día; el resto está en Alertas" />
          <div className="flex flex-col gap-[8px]">
            {sinAbrir.length > 0 && (
              <AlertRow
                color="warn"
                title={`${sinAbrir.length === 1 ? "Una sucursal" : `${sinAbrir.length} sucursales`} todavía no abrió la caja`}
                sub={sinAbrir.map((s) => s.nombre).join(" · ")}
                href="/reportes/caja"
              />
            )}
            {enTransito > 0 && (
              <AlertRow
                color="info"
                title={`${enTransito} transferencia${enTransito === 1 ? "" : "s"} en tránsito`}
                sub="Mercadería que salió de Olavarría y Laprida todavía no recibió"
                href="/pedidos"
              />
            )}
          </div>
        </div>
      )}

      <div>
        <SectionHeader title="Reportes" meta="Todo lo que antes estaba en esta pantalla" />
        <QuickActions>
          <QuickAction
            href="/reportes/caja"
            label="Caja y dinero"
            sub="Ventas, medios de pago, cierres, egresos, devoluciones y particulares"
          />
          <QuickAction
            href="/reportes/stock"
            label="Productos y stock"
            sub="Más vendidos, vencimientos, inmovilizado, mermas, costos y precios"
          />
          <QuickAction href="/reportes/alertas" label="Alertas" sub="Lo que necesita una decisión" />
          <QuickAction href="/reportes/iva" label="Balance de IVA" sub="Ventas y compras del mes" />
        </QuickActions>
      </div>
    </div>
  );
}
