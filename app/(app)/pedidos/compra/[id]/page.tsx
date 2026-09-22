import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esDueno, veCostos } from "@/lib/permisos";
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
      `id, numero, estado, fecha_creacion, fecha_resolucion, observaciones, visto_en,
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

  const soloLectura = await esDueno(supabase);
  // Marca el pedido como visto la primera vez que el dueño abre su
  // detalle -- de eso vive el badge rojo en "Pedidos" del sidebar (pedido
  // del usuario 2026-09-22). Función acotada (ver migración
  // 20260922150000): no reabre el update general que le sacamos al dueño.
  if (soloLectura) {
    await supabase.rpc("marcar_pedido_compra_visto", { p_id: id });
  }

  const skuIds = pedidoCompra.pedidos_compra_items.map((i) => i.sku_id);
  const { data: proveedorSkus } = await supabase
    .from("proveedor_skus")
    .select("sku_id, proveedor:proveedores ( id, razon_social, nombre_comercial )")
    .eq("activo", true)
    .in("sku_id", skuIds);

  // Mismo criterio que la pantalla de armar el pedido (sugerencia-compra-
  // form.tsx): un SKU con más de un proveedor queda repetido en cada grupo,
  // y sin proveedor cargado va a su propio grupo.
  const proveedoresPorSku: Record<string, { id: string; nombre: string }[]> = {};
  for (const fila of (proveedorSkus ?? []) as unknown as {
    sku_id: string;
    proveedor: { id: string; razon_social: string; nombre_comercial: string | null } | null;
  }[]) {
    if (!fila.proveedor) continue;
    const lista = proveedoresPorSku[fila.sku_id] ?? [];
    lista.push({ id: fila.proveedor.id, nombre: fila.proveedor.nombre_comercial ?? fila.proveedor.razon_social });
    proveedoresPorSku[fila.sku_id] = lista;
  }

  return (
    <PedidoCompraDetalle
      pedido={pedidoCompra as unknown as PedidoCompraDetalleData}
      proveedoresPorSku={proveedoresPorSku}
      soloLectura={soloLectura}
    />
  );
}
