import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { SugerenciaCompraForm, type SugerenciaCompraSku } from "../../_components/sugerencia-compra-form";

type Sugerencia = {
  sku_id: string;
  stock_actual: number;
  en_camino: number;
  stock_objetivo: number;
  sugerido: number;
};

export default async function NuevoPedidoCompraPage() {
  const supabase = await createClient();

  const { data: central } = await supabase.from("sucursales").select("id").eq("es_central", true).single();

  if (!central || !(await operaSucursal(supabase, central.id))) {
    redirect("/pedidos");
  }

  const [{ data: sugerencias }, { data: skus }, { data: proveedorSkus }] = await Promise.all([
    supabase.rpc("sugerir_compra_semanal"),
    supabase
      .from("skus")
      .select(
        `id, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
    supabase
      .from("proveedor_skus")
      .select("sku_id, proveedor:proveedores ( id, razon_social, nombre_comercial )")
      .eq("activo", true),
  ]);

  const skuPorId = new Map((skus ?? []).map((s) => [s.id, s]));

  const filas: SugerenciaCompraSku[] = ((sugerencias ?? []) as Sugerencia[])
    .map((s) => {
      const sku = skuPorId.get(s.sku_id);
      if (!sku) return null;
      return { ...s, sku: sku as unknown as SugerenciaCompraSku["sku"] };
    })
    .filter((f): f is SugerenciaCompraSku => f !== null);

  filas.sort((a, b) => {
    const marcaA = a.sku.producto?.marca?.nombre ?? "";
    const marcaB = b.sku.producto?.marca?.nombre ?? "";
    if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");

    const productoA = a.sku.producto?.nombre ?? "";
    const productoB = b.sku.producto?.nombre ?? "";
    if (productoA !== productoB) return productoA.localeCompare(productoB, "es");

    return a.sku.unidades_contenidas - b.sku.unidades_contenidas;
  });

  // Un SKU puede tener más de un proveedor cargado (proveedor_skus es
  // muchos a muchos, sin uno "principal") -- se agrupa por cada proveedor
  // que lo tenga asociado, y el que no tenga ninguno queda en su propio
  // grupo "Sin proveedor asignado" (decisión del usuario 2026-09-21).
  const proveedoresPorSku = new Map<string, { id: string; nombre: string }[]>();
  for (const fila of (proveedorSkus ?? []) as unknown as {
    sku_id: string;
    proveedor: { id: string; razon_social: string; nombre_comercial: string | null } | null;
  }[]) {
    if (!fila.proveedor) continue;
    const lista = proveedoresPorSku.get(fila.sku_id) ?? [];
    lista.push({ id: fila.proveedor.id, nombre: fila.proveedor.nombre_comercial ?? fila.proveedor.razon_social });
    proveedoresPorSku.set(fila.sku_id, lista);
  }

  return <SugerenciaCompraForm filas={filas} proveedoresPorSku={Object.fromEntries(proveedoresPorSku)} />;
}
