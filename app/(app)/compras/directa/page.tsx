import { createClient } from "@/lib/supabase/server";
import { CompraDirectaForm } from "../_components/compra-directa-form";
import type { SkuCatalogo } from "../_components/sku-picker";

export default async function CompraDirectaPage() {
  const supabase = await createClient();

  const [{ data: proveedores }, { data: skus }, { data: costosReferencia }] = await Promise.all([
    supabase
      .from("proveedores")
      .select("id, razon_social, nombre_comercial")
      .eq("activo", true)
      .order("razon_social"),
    supabase
      .from("skus")
      .select(
        `id, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         desarma_en_sku_id,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
    supabase.from("proveedor_skus").select("proveedor_id, sku_id, costo_referencia"),
  ]);

  return (
    <CompraDirectaForm
      proveedores={proveedores ?? []}
      skus={(skus ?? []) as unknown as SkuCatalogo[]}
      costosReferencia={costosReferencia ?? []}
    />
  );
}
