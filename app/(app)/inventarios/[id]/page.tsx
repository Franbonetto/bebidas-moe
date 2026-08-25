import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { ConteoForm, type ItemConteo } from "../_components/conteo-form";

export default async function InventarioDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: inventario } = await supabase
    .from("inventarios")
    .select(
      `id, tipo, estado, fecha_inicio, fecha_fin,
       sucursal:sucursales ( id, nombre ),
       categoria:categorias ( nombre )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!inventario) notFound();

  const sucursal = inventario.sucursal as unknown as { id: string; nombre: string } | null;

  const [{ data: items }, puedeOperar] = await Promise.all([
    supabase
      .from("inventario_items")
      .select(
        `id, sku_id, stock_sistema, stock_contado, diferencia, motivo,
         sku:skus ( codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           producto:productos ( nombre, marca:marcas ( nombre ) ) )`,
      )
      .eq("inventario_id", id),
    sucursal ? operaSucursal(supabase, sucursal.id) : Promise.resolve(false),
  ]);

  const itemsList = ((items ?? []) as unknown as ItemConteo[]).slice();
  itemsList.sort((a, b) => {
    const marcaA = a.sku.producto?.marca?.nombre ?? "";
    const marcaB = b.sku.producto?.marca?.nombre ?? "";
    if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");
    const productoA = a.sku.producto?.nombre ?? "";
    const productoB = b.sku.producto?.nombre ?? "";
    if (productoA !== productoB) return productoA.localeCompare(productoB, "es");
    return a.sku.unidades_contenidas - b.sku.unidades_contenidas;
  });

  return (
    <ConteoForm
      inventario={{
        id: inventario.id,
        tipo: inventario.tipo,
        estado: inventario.estado,
        fecha_inicio: inventario.fecha_inicio,
        fecha_fin: inventario.fecha_fin,
        sucursal_nombre: sucursal?.nombre ?? "—",
        categoria_nombre: (inventario.categoria as unknown as { nombre: string } | null)?.nombre ?? null,
      }}
      items={itemsList}
      puedeOperar={puedeOperar}
    />
  );
}
