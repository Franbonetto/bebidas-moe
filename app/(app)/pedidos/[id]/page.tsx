import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal, veCostos } from "@/lib/permisos";
import { PedidoDetalle, type PedidoDetalleData } from "../_components/pedido-detalle";

export default async function PedidoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: pedido } = await supabase
    .from("pedidos")
    .select(
      `id, numero, estado, fecha_creacion, fecha_envio, fecha_cierre, motivo_cierre_manual,
       sucursal_origen_id, sucursal_destino_id,
       pedido_items (
         id, sku_id, cantidad_solicitada, cantidad_preparada, cantidad_pendiente, observacion_encargado,
         sku:skus ( nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
                    producto:productos ( nombre, marca:marcas ( nombre ) ) )
       ),
       transferencias (
         id, estado, fecha_despacho, fecha_recepcion, observaciones,
         transferencia_items ( id, pedido_item_id, sku_id, cantidad_despachada, cantidad_recibida, diferencia, motivo_diferencia )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!pedido) notFound();

  const pedidoData = pedido as unknown as PedidoDetalleData & {
    sucursal_origen_id: string;
    sucursal_destino_id: string;
  };

  const [puedeOrigen, puedeDestino, puedeVerCostos] = await Promise.all([
    operaSucursal(supabase, pedidoData.sucursal_origen_id),
    operaSucursal(supabase, pedidoData.sucursal_destino_id),
    veCostos(supabase),
  ]);

  const skuIds = pedidoData.pedido_items.map((i) => i.sku_id);

  const stockOrigen: Record<string, number> = {};
  const disponibleOrigen: Record<string, number> = {};
  let valorTotal = 0;

  if (skuIds.length > 0) {
    const [{ data: stockRows }, { data: skuRows }] = await Promise.all([
      supabase
        .from("stock_sucursal")
        .select("sku_id, cantidad")
        .eq("sucursal_id", pedidoData.sucursal_origen_id)
        .in("sku_id", skuIds),
      supabase.from("skus").select("id, stock_minimo, costo_actual").in("id", skuIds),
    ]);

    const minimoPorSku = new Map((skuRows ?? []).map((s) => [s.id, s.stock_minimo]));
    for (const fila of stockRows ?? []) {
      stockOrigen[fila.sku_id] = fila.cantidad;
      const minimo = minimoPorSku.get(fila.sku_id) ?? 0;
      disponibleOrigen[fila.sku_id] = Math.max(fila.cantidad - minimo, 0);
    }

    // Valor a costo del pedido (cantidad solicitada × costo_actual) — solo
    // para quien ve costos (CLAUDE.md: Laprida no). Es una transferencia
    // interna, no una venta, por eso se valoriza a costo y no a precio.
    if (puedeVerCostos) {
      const costoPorSku = new Map((skuRows ?? []).map((s) => [s.id, s.costo_actual]));
      for (const item of pedidoData.pedido_items) {
        const costo = costoPorSku.get(item.sku_id);
        if (costo != null) valorTotal += item.cantidad_solicitada * costo;
      }
    }
  }

  return (
    <PedidoDetalle
      pedido={pedidoData}
      puedeOrigen={puedeOrigen}
      puedeDestino={puedeDestino}
      stockOrigen={stockOrigen}
      disponibleOrigen={disponibleOrigen}
      valorTotal={puedeVerCostos ? valorTotal : null}
    />
  );
}
