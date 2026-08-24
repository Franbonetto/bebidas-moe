import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { SugerenciaForm, type SugerenciaSku } from "../_components/sugerencia-form";

type Sugerencia = {
  sku_id: string;
  stock_actual: number;
  en_transito: number;
  pendiente_pedidos_abiertos: number;
  stock_objetivo: number;
  arrastre: number;
  sugerido: number;
};

export default async function NuevoPedidoPage() {
  const supabase = await createClient();

  const { data: laprida } = await supabase
    .from("sucursales")
    .select("id")
    .eq("es_central", false)
    .single();

  if (!laprida || !(await operaSucursal(supabase, laprida.id))) {
    redirect("/pedidos");
  }

  const [{ data: sugerencias }, { data: skus }] = await Promise.all([
    supabase.rpc("sugerir_pedido", { p_sucursal_destino_id: laprida.id }),
    supabase
      .from("skus")
      .select(
        `id, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
  ]);

  const skuPorId = new Map((skus ?? []).map((s) => [s.id, s]));

  const filas: SugerenciaSku[] = ((sugerencias ?? []) as Sugerencia[])
    .map((s) => {
      const sku = skuPorId.get(s.sku_id);
      if (!sku) return null;
      return { ...s, sku: sku as unknown as SugerenciaSku["sku"] };
    })
    .filter((f): f is SugerenciaSku => f !== null);

  // Ordenado en JS (no en la query) porque involucra dos niveles de join
  // embebido (sku -> producto -> marca). Marca primero para que las
  // presentaciones de un mismo producto queden agrupadas.
  filas.sort((a, b) => {
    const marcaA = a.sku.producto?.marca?.nombre ?? "";
    const marcaB = b.sku.producto?.marca?.nombre ?? "";
    if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");

    const productoA = a.sku.producto?.nombre ?? "";
    const productoB = b.sku.producto?.nombre ?? "";
    if (productoA !== productoB) return productoA.localeCompare(productoB, "es");

    return a.sku.unidades_contenidas - b.sku.unidades_contenidas;
  });

  return <SugerenciaForm filas={filas} />;
}
