import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { calcularProductosPorVencer, haceDias } from "./lib";
import {
  AlertRow,
  Badge,
  Card,
  EmptyState,
  QuickAction,
  QuickActions,
  SectionHeader,
  StatRow,
} from "./ui";

type SkuInfo = SkuPresentacion & {
  id: string;
  nombre: string;
  stock_minimo: number;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type Sugerencia = { sku_id: string; sugerido: number };

export async function LapridaDashboard() {
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre, es_central")
    .eq("activo", true);

  const laprida = (sucursales ?? []).find((s) => !s.es_central);
  if (!laprida) {
    return (
      <EmptyState title="Falta configurar la sucursal de Laprida" sub="No hay ninguna sucursal marcada como no central." />
    );
  }

  const [
    { data: skus },
    { data: stockLaprida },
    { data: pedidoBorrador },
    { data: sugerencias },
    { data: transferenciasEnTransito },
    { data: historial },
  ] = await Promise.all([
    supabase
      .from("skus")
      .select(
        `id, nombre, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, stock_minimo,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
    supabase.from("stock_sucursal").select("sku_id, cantidad").eq("sucursal_id", laprida.id),
    supabase
      .from("pedidos")
      .select("id, numero, pedido_items ( cantidad_solicitada )")
      .eq("sucursal_destino_id", laprida.id)
      .eq("estado", "borrador")
      .order("fecha_creacion", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("sugerir_pedido", { p_sucursal_destino_id: laprida.id }),
    supabase
      .from("transferencias")
      .select(
        `id, pedido_id, fecha_despacho, observaciones,
         pedido:pedidos ( numero ),
         transferencia_items ( cantidad_despachada )`,
      )
      .eq("sucursal_destino_id", laprida.id)
      .eq("estado", "en_transito")
      .order("fecha_despacho", { ascending: true }),
    supabase
      .from("historial_costos")
      .select("sku_id, fecha, fecha_vencimiento")
      .order("fecha", { ascending: false }),
  ]);

  const skusList = (skus ?? []) as unknown as SkuInfo[];
  const skuPorId = new Map(skusList.map((s) => [s.id, s]));
  const stockPorSku = new Map((stockLaprida ?? []).map((f) => [f.sku_id, f.cantidad as number]));

  const faltantes = skusList
    .map((sku) => ({ sku, stock: stockPorSku.get(sku.id) ?? 0 }))
    .filter((f) => f.stock <= 0 || (f.sku.stock_minimo > 0 && f.stock < f.sku.stock_minimo))
    .sort((a, b) => a.stock - b.stock);

  const sinStock = faltantes.filter((f) => f.stock <= 0);
  const bajoMinimo = faltantes.filter((f) => f.stock > 0);

  const sugeridas = ((sugerencias ?? []) as Sugerencia[]).filter((s) => s.sugerido > 0);
  const unidadesSugeridas = sugeridas.reduce((acc, s) => acc + s.sugerido, 0);

  type Transferencia = {
    id: string;
    pedido_id: string;
    fecha_despacho: string;
    observaciones: string | null;
    pedido: { numero: string } | null;
    transferencia_items: { cantidad_despachada: number }[];
  };
  const transferenciasList = (transferenciasEnTransito ?? []) as unknown as Transferencia[];

  // Productos próximos a vencer con stock hoy en Laprida (pedido del
  // usuario 2026-09-22). El vencimiento se carga al recibir en Olavarría
  // (única sucursal que compra), pero se muestra acá igual porque es el
  // mismo SKU del catálogo global -- el stock no rastrea de qué lote sale
  // cada unidad, así que es la misma aproximación que ya usa costo_actual.
  const productosPorVencer = calcularProductosPorVencer(
    (historial ?? []) as { sku_id: string; fecha_vencimiento: string | null; fecha: string }[],
  ).filter((v) => (stockPorSku.get(v.sku_id) ?? 0) > 0);

  const pedidoBorradorData = pedidoBorrador as unknown as {
    id: string;
    numero: string;
    pedido_items: { cantidad_solicitada: number }[];
  } | null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionHeader title="Necesita atención" />
        <div className="flex flex-col gap-[8px]">
          {sinStock.length === 0 &&
          bajoMinimo.length === 0 &&
          transferenciasList.length === 0 &&
          !pedidoBorradorData ? (
            <EmptyState title="Todo al día" sub="No hay alertas activas en este momento." />
          ) : (
            <>
              {sinStock.length > 0 && (
                <AlertRow
                  color="err"
                  title={`${sinStock.length} producto${sinStock.length === 1 ? "" : "s"} sin stock`}
                  href="/productos"
                />
              )}
              {bajoMinimo.length > 0 && (
                <AlertRow
                  color="warn"
                  title={`${bajoMinimo.length} producto${bajoMinimo.length === 1 ? "" : "s"} bajo el mínimo`}
                  sub="Incluidos en la sugerencia de pedido"
                  href="/productos"
                />
              )}
              {transferenciasList.length > 0 && (
                <AlertRow
                  color="info"
                  title={`${transferenciasList.length} transferencia${transferenciasList.length === 1 ? "" : "s"} en camino`}
                  href="/pedidos"
                />
              )}
              {pedidoBorradorData && (
                <AlertRow
                  color="warn"
                  title="Tenés un pedido en borrador sin enviar"
                  sub={pedidoBorradorData.numero}
                  href={`/pedidos/${pedidoBorradorData.id}`}
                />
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <SectionHeader title="Acciones rápidas" />
        <QuickActions>
          <QuickAction
            href={pedidoBorradorData ? `/pedidos/${pedidoBorradorData.id}` : "/pedidos/nuevo"}
            label={pedidoBorradorData ? "Continuar pedido semanal" : "Hacer pedido semanal"}
            sub={pedidoBorradorData ? pedidoBorradorData.numero : `${sugeridas.length} productos sugeridos`}
          />
          <QuickAction href="/pedidos" label="Ver mis pedidos" sub="Historial y estado" />
          <QuickAction href="/inventarios/nuevo" label="Hacer inventario" sub="General, por categoría o puntual" />
        </QuickActions>
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        <Card title="Pedido semanal">
          <div className="flex flex-col divide-y divide-[#F1F1F3]">
            {pedidoBorradorData ? (
              <StatRow
                label="Borrador en curso"
                value={pedidoBorradorData.numero}
                sub={`${pedidoBorradorData.pedido_items.length} productos cargados`}
              />
            ) : (
              <StatRow
                label="Sugerencia disponible"
                value={sugeridas.length}
                sub={`${unidadesSugeridas} unidades sugeridas`}
              />
            )}
          </div>
        </Card>

        <Card title="Mercadería en camino">
          {transferenciasList.length === 0 ? (
            <EmptyState title="Nada en tránsito" sub="Las transferencias que despache Olavarría van a aparecer acá." />
          ) : (
            <div className="flex flex-col">
              {transferenciasList.map((t) => {
                const unidades = t.transferencia_items.reduce((acc, i) => acc + i.cantidad_despachada, 0);
                return (
                  <Link
                    key={t.id}
                    href={`/pedidos/${t.pedido_id}`}
                    className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[10px] last:border-b-0 hover:bg-[#FAFAFB]"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-text">{t.pedido?.numero ?? "Pedido"}</p>
                      <p className="text-[11.5px] text-text-3">
                        {unidades} unidades · Despachada {haceDias(t.fecha_despacho)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card title="Qué falta">
        {faltantes.length === 0 ? (
          <EmptyState title="No falta nada" sub="Ningún producto está sin stock ni por debajo de su mínimo." />
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
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Mínimo
                  </th>
                </tr>
              </thead>
              <tbody>
                {faltantes.map(({ sku, stock }) => (
                  <tr key={sku.id} className="border-b border-[#F1F1F3] last:border-b-0">
                    <td className="px-[14px] py-[9px] align-middle">
                      <p className="font-medium text-text">{sku.producto?.nombre ?? sku.nombre}</p>
                      <p className="text-[11.5px] text-text-3">
                        {[sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ")}
                      </p>
                    </td>
                    <td
                      className={`px-[14px] py-[9px] text-right align-middle font-medium tabular-nums ${
                        stock <= 0 ? "text-err" : "text-warn"
                      }`}
                    >
                      {stock}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {sku.stock_minimo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Productos próximos a vencer · 30 días">
        {productosPorVencer.length === 0 ? (
          <EmptyState title="Sin vencimientos próximos" sub="Ningún producto con vencimiento cargado vence en los próximos 30 días." />
        ) : (
          <div className="flex flex-col">
            {productosPorVencer.map((v) => {
              const sku = skuPorId.get(v.sku_id);
              return (
                <div
                  key={v.sku_id}
                  className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[10px] last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-text">{sku?.producto?.nombre ?? sku?.nombre ?? "—"}</p>
                    <p className="text-[11.5px] text-text-3">
                      {sku ? presentacionLabel(sku) : ""} · vence {v.fecha_vencimiento.split("-").reverse().join("/")}
                    </p>
                  </div>
                  <Badge color={v.dias_restantes < 0 ? "err" : v.dias_restantes <= 7 ? "warn" : "info"}>
                    {v.dias_restantes < 0
                      ? "Vencido"
                      : v.dias_restantes === 0
                        ? "Vence hoy"
                        : `${v.dias_restantes} días`}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
