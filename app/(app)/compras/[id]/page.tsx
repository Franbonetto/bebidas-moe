import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompraDetalle, type CompraDetalleData, type RecepcionDetalle } from "../_components/compra-detalle";

export default async function CompraDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: compra } = await supabase
    .from("compras")
    .select(
      `id, numero_factura, fecha_factura, estado, total,
       proveedor:proveedores ( id, razon_social, nombre_comercial ),
       compra_items (
         id, sku_id, cantidad, costo_unitario, subtotal, fecha_vencimiento,
         sku:skus ( nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
                    producto:productos ( nombre, marca:marcas ( nombre ) ) )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!compra) notFound();

  const { data: recepciones } = await supabase
    .from("recepciones_compra")
    .select(
      `id, fecha, estado, usuario:usuarios ( nombre ),
       recepcion_items ( compra_item_id, cantidad_recibida, diferencia, motivo_diferencia )`,
    )
    .eq("compra_id", id)
    .order("fecha", { ascending: true });

  const recepcionesList = (recepciones ?? []) as unknown as RecepcionDetalle[];

  const recibidoPorItem = new Map<string, number>();
  for (const r of recepcionesList) {
    if (r.estado !== "recibida") continue;
    for (const it of r.recepcion_items) {
      recibidoPorItem.set(
        it.compra_item_id,
        (recibidoPorItem.get(it.compra_item_id) ?? 0) + it.cantidad_recibida,
      );
    }
  }

  const compraRaw = compra as unknown as Omit<CompraDetalleData, "items">;
  const itemsRaw = (compra as unknown as { compra_items: CompraDetalleData["items"] }).compra_items ?? [];

  const items = itemsRaw.map((it) => {
    const recibidoPrevio = recibidoPorItem.get(it.id) ?? 0;
    return { ...it, recibido_previo: recibidoPrevio, pendiente: it.cantidad - recibidoPrevio };
  });

  return <CompraDetalle compra={{ ...compraRaw, items }} recepciones={recepcionesList} />;
}
