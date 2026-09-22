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
         cascada_cerveza_lata, desarma_en_sku_id,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
    supabase.from("proveedor_skus").select("proveedor_id, sku_id, costo_referencia"),
  ]);

  // Ofrecer "activar cascada" solo en el pack x24 de una familia que todavía
  // no la tiene prendida y que sí tiene la cadena de desarme armada (x24 ->
  // x6 -> unidad, ver 28_fix_direccion_cascada_desarme.sql) -- es la señal
  // real de "esto es una familia de cerveza en lata", más precisa que
  // guiarse por categoría (evita mezclar con presentaciones retornables del
  // mismo producto). Pedido del usuario 2026-09-21.
  const skusList = (skus ?? []) as unknown as (SkuCatalogo & {
    cascada_cerveza_lata: boolean;
    desarma_en_sku_id: string | null;
  })[];

  const skusConCascadaOfrecida = skusList
    .filter((s) => s.unidades_contenidas === 24 && !s.cascada_cerveza_lata && s.desarma_en_sku_id)
    .map((s) => s.id);

  // x24 que YA tiene la cascada activada: cada compra siguiente vuelve a
  // pedir el precio de venta (es la base de la que bajan x6 y unidad, no
  // hay un valor "de siempre" que reusar solo -- la encargada define el
  // precio en el momento, arquitectura.md 1.11).
  const skusConCascadaActiva = skusList
    .filter((s) => s.unidades_contenidas === 24 && s.cascada_cerveza_lata)
    .map((s) => s.id);

  return (
    <CompraDirectaForm
      proveedores={proveedores ?? []}
      skus={skusList as unknown as SkuCatalogo[]}
      costosReferencia={costosReferencia ?? []}
      skusConCascadaOfrecida={skusConCascadaOfrecida}
      skusConCascadaActiva={skusConCascadaActiva}
    />
  );
}
