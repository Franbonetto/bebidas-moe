import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { veCostos } from "@/lib/permisos";
import { PedidoCompraDetalle, type PedidoCompraDetalleData } from "../../_components/pedido-compra-detalle";

export default async function PedidoCompraDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const puedeVer = await veCostos(supabase);
  if (!puedeVer) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés permiso para ver los pedidos de compra.
      </div>
    );
  }

  const { data: pedidoCompra } = await supabase
    .from("pedidos_compra")
    .select(
      `id, numero, estado, fecha_creacion, fecha_resolucion, observaciones,
       creador:usuarios!pedidos_compra_usuario_creador_id_fkey ( nombre ),
       resolutor:usuarios!pedidos_compra_usuario_resolucion_id_fkey ( nombre ),
       pedidos_compra_items (
         id, sku_id, cantidad_sugerida, cantidad_solicitada,
         sku:skus ( nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
                    producto:productos ( nombre, marca:marcas ( nombre ) ) )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!pedidoCompra) notFound();

  return <PedidoCompraDetalle pedido={pedidoCompra as unknown as PedidoCompraDetalleData} />;
}
