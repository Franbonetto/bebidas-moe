import { createClient } from "@/lib/supabase/server";
import { esDueno } from "@/lib/permisos";
import { CompraDirectaForm } from "../_components/compra-directa-form";
import type { SkuCatalogo } from "../_components/sku-picker";

export default async function CompraDirectaPage() {
  const supabase = await createClient();

  // El dueño solo visualiza compras y recepciones -- las carga la
  // encargada de Olavarría (pedido del usuario 2026-09-22: "el dueño no
  // pueda recepcionar mercadería").
  if (await esDueno(supabase)) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        Este panel es para que la encargada cargue la mercadería que llega. Como dueño, podés ver
        todo lo cargado desde{" "}
        <a href="/compras" className="text-moe hover:underline">
          Compras
        </a>
        .
      </div>
    );
  }

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
