import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { EstadoPedidoBadge, type EstadoPedido } from "@/app/(app)/pedidos/_components/estado-pedido-badge";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { calcularCostosQueSubieron, haceDias } from "./lib";
import {
  AlertRow,
  Badge,
  Card,
  EmptyState,
  PlaceholderCard,
  QuickAction,
  QuickActions,
  SectionHeader,
} from "./ui";

type SkuInfo = SkuPresentacion & {
  id: string;
  nombre: string;
  stock_minimo: number;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type PedidoRow = {
  id: string;
  numero: string;
  estado: EstadoPedido;
  fecha_envio: string | null;
  pedido_items: { cantidad_solicitada: number }[];
};

export async function OlavarriaDashboard() {
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre, es_central")
    .eq("activo", true);

  const olavarria = (sucursales ?? []).find((s) => s.es_central);
  if (!olavarria) {
    return (
      <EmptyState title="Falta configurar la sucursal central" sub="No hay ninguna sucursal marcada como central." />
    );
  }

  const [
    { data: pedidos },
    { data: skus },
    { data: stockOlavarria },
    { data: proveedorSkusActivos },
    { data: historial },
    { data: recepcionesPendientes },
  ] = await Promise.all([
    supabase
      .from("pedidos")
      .select("id, numero, estado, fecha_envio, pedido_items ( cantidad_solicitada )")
      .eq("sucursal_origen_id", olavarria.id)
      .in("estado", ["enviado", "en_preparacion", "preparado", "despachado"])
      .order("fecha_envio", { ascending: true }),
    supabase
      .from("skus")
      .select(
        `id, nombre, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, stock_minimo,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true)
      .gt("stock_minimo", 0),
    supabase.from("stock_sucursal").select("sku_id, cantidad").eq("sucursal_id", olavarria.id),
    supabase.from("proveedor_skus").select("sku_id").eq("activo", true),
    supabase.from("historial_costos").select("sku_id, costo_unitario, fecha").order("fecha", { ascending: false }),
    supabase
      .from("recepciones_compra")
      .select(
        `id, fecha, compra:compras ( id, proveedor:proveedores ( razon_social, nombre_comercial ) )`,
      )
      .eq("estado", "pendiente")
      .order("fecha", { ascending: true }),
  ]);

  const pedidosList = (pedidos ?? []) as unknown as PedidoRow[];
  const sinAtender = pedidosList.filter((p) => p.estado === "enviado");
  const enCurso = pedidosList.filter((p) => p.estado !== "enviado");

  const skusList = (skus ?? []) as unknown as SkuInfo[];
  const stockPorSku = new Map((stockOlavarria ?? []).map((f) => [f.sku_id, f.cantidad as number]));
  const conProveedor = new Set((proveedorSkusActivos ?? []).map((f) => f.sku_id as string));

  const productosAComprar = skusList
    .map((sku) => {
      const stock = stockPorSku.get(sku.id) ?? 0;
      return { sku, stock, deficit: sku.stock_minimo - stock, tieneProveedor: conProveedor.has(sku.id) };
    })
    .filter((f) => f.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);

  const sinProveedorCount = productosAComprar.filter((f) => !f.tieneProveedor).length;

  const costosSubieron = calcularCostosQueSubieron(
    (historial ?? []) as { sku_id: string; costo_unitario: number; fecha: string }[],
  );
  const skuPorId = new Map(skusList.map((s) => [s.id, s]));

  type RecepcionPendiente = {
    id: string;
    fecha: string;
    compra: { id: string; proveedor: { razon_social: string; nombre_comercial: string | null } | null } | null;
  };
  const recepcionesList = (recepcionesPendientes ?? []) as unknown as RecepcionPendiente[];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionHeader title="Necesita atención" />
        <div className="flex flex-col gap-[8px]">
          {sinAtender.length === 0 && productosAComprar.length === 0 && costosSubieron.length === 0 ? (
            <EmptyState title="Todo al día" sub="No hay pedidos ni compras que necesiten tu atención ahora mismo." />
          ) : (
            <>
              {sinAtender.length > 0 && (
                <AlertRow
                  color="err"
                  title={`${sinAtender.length} pedido${sinAtender.length === 1 ? "" : "s"} de Laprida sin atender`}
                  sub={sinAtender.map((p) => p.numero).join(", ")}
                  href={sinAtender.length === 1 ? `/pedidos/${sinAtender[0].id}` : "/pedidos"}
                />
              )}
              {productosAComprar.length > 0 && (
                <AlertRow
                  color="warn"
                  title={`${productosAComprar.length} producto${productosAComprar.length === 1 ? "" : "s"} bajo el mínimo`}
                  sub={sinProveedorCount > 0 ? `${sinProveedorCount} sin proveedor asignado` : undefined}
                />
              )}
              {costosSubieron.length > 0 && (
                <AlertRow
                  color="orange"
                  title={`${costosSubieron.length} costo${costosSubieron.length === 1 ? "" : "s"} aumentaron este mes`}
                  sub="Últimos 30 días — revisar precios de venta"
                />
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <SectionHeader title="Acciones rápidas" />
        <QuickActions>
          <QuickAction href="/compras/nueva" label="Cargar compra" sub="Nueva factura de proveedor" />
          <QuickAction href="/pedidos" label="Ver pedidos de Laprida" sub={`${enCurso.length} en curso`} />
          <QuickAction href="/inventarios/nuevo" label="Hacer inventario" sub="General, por categoría o puntual" />
        </QuickActions>
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        <Card title="Pedidos de Laprida pendientes">
          {pedidosList.length === 0 ? (
            <EmptyState title="Sin pedidos pendientes" sub="Los pedidos que Laprida envíe van a aparecer acá." />
          ) : (
            <div className="flex flex-col">
              {pedidosList.map((p) => {
                const unidades = p.pedido_items.reduce((acc, i) => acc + i.cantidad_solicitada, 0);
                return (
                  <Link
                    key={p.id}
                    href={`/pedidos/${p.id}`}
                    className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[10px] last:border-b-0 hover:bg-[#FAFAFB]"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-text">{p.numero}</p>
                      <p className="text-[11.5px] text-text-3">
                        {unidades} unidades{p.fecha_envio ? ` · Enviado ${haceDias(p.fecha_envio)}` : ""}
                      </p>
                    </div>
                    <EstadoPedidoBadge estado={p.estado} />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Recepciones de compra pendientes">
          {recepcionesList.length === 0 ? (
            <EmptyState title="Sin recepciones pendientes" sub="Las compras confirmadas que esperan mercadería van a aparecer acá." />
          ) : (
            <div className="flex flex-col">
              {recepcionesList.map((r) => (
                <Link
                  key={r.id}
                  href={`/compras/${r.compra?.id}`}
                  className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[10px] last:border-b-0 hover:bg-[#FAFAFB]"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-text">
                      {r.compra?.proveedor?.nombre_comercial ?? r.compra?.proveedor?.razon_social ?? "—"}
                    </p>
                    <p className="text-[11.5px] text-text-3">Pendiente {haceDias(r.fecha)}</p>
                  </div>
                  <Badge color="info">Pendiente</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        <Card title="Productos a comprar">
          {productosAComprar.length === 0 ? (
            <EmptyState title="Sin faltantes" sub="Ningún producto está por debajo de su stock mínimo." />
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
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Proveedor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {productosAComprar.map(({ sku, stock, tieneProveedor }) => (
                    <tr key={sku.id} className="border-b border-[#F1F1F3] last:border-b-0">
                      <td className="px-[14px] py-[9px] align-middle">
                        <p className="font-medium text-text">{sku.producto?.nombre ?? sku.nombre}</p>
                        <p className="text-[11.5px] text-text-3">
                          {[sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ")}
                        </p>
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">{stock}</td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {sku.stock_minimo}
                      </td>
                      <td className="px-[14px] py-[9px] align-middle">
                        {tieneProveedor ? (
                          <Badge color="ok">Asignado</Badge>
                        ) : (
                          <Badge color="err">Sin proveedor</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Costos que subieron · últimos 30 días">
          {costosSubieron.length === 0 ? (
            <EmptyState title="Sin aumentos recientes" sub="Ningún costo de compra subió en los últimos 30 días." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Producto
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Antes → Ahora
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Variación
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {costosSubieron.map((c) => {
                    const sku = skuPorId.get(c.sku_id);
                    return (
                      <tr key={c.sku_id} className="border-b border-[#F1F1F3] last:border-b-0">
                        <td className="px-[14px] py-[9px] align-middle">
                          <p className="font-medium text-text">{sku?.producto?.nombre ?? "SKU eliminado"}</p>
                          <p className="text-[11.5px] text-text-3">{haceDias(c.fecha)}</p>
                        </td>
                        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                          {formatoMoneda.format(c.costo_anterior)} → {formatoMoneda.format(c.costo_nuevo)}
                        </td>
                        <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-orange">
                          +{c.variacion_pct.toFixed(1)}%
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

      <PlaceholderCard
        title="Envases"
        nota="El circuito de envases retornables (bloque 9 de arquitectura.md) todavía no está implementado. Cuando exista, acá va a aparecer cuánto hay para devolver al proveedor."
      />
    </div>
  );
}
