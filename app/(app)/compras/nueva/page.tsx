import { createClient } from "@/lib/supabase/server";
import { CompraForm } from "../_components/compra-form";
import type { SkuCatalogo } from "../_components/sku-picker";

export default async function NuevaCompraPage() {
  const supabase = await createClient();

  const [{ data: proveedores }, { data: skus }] = await Promise.all([
    supabase
      .from("proveedores")
      .select("id, razon_social, nombre_comercial")
      .eq("activo", true)
      .order("razon_social"),
    supabase
      .from("skus")
      .select(
        `id, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
  ]);

  return (
    <CompraForm
      proveedores={proveedores ?? []}
      skus={(skus ?? []) as unknown as SkuCatalogo[]}
    />
  );
}
