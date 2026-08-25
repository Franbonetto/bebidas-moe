import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { NuevoInventarioForm, type CatalogoSku } from "../_components/nuevo-inventario-form";

export default async function NuevoInventarioPage() {
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    redirect("/inventarios");
  }

  const [{ data: categorias }, { data: skus }, abiertosPorSucursal, sugeridosPorSucursal] =
    await Promise.all([
      supabase.from("categorias").select("id, nombre").eq("activo", true).order("nombre"),
      supabase
        .from("skus")
        .select(
          `id, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           producto:productos ( nombre, marca:marcas ( nombre ) )`,
        )
        .eq("activo", true),
      Promise.all(
        sucursalesOperables.map(async (s) => {
          const { data } = await supabase
            .from("inventarios")
            .select("id")
            .eq("sucursal_id", s.id)
            .eq("estado", "abierto")
            .maybeSingle();
          return [s.id, data?.id ?? null] as const;
        }),
      ),
      Promise.all(
        sucursalesOperables.map(async (s) => {
          const { data } = await supabase.rpc("sugerir_conteo_puntual", { p_sucursal_id: s.id });
          return [s.id, new Set((data ?? []).map((d: { sku_id: string }) => d.sku_id))] as const;
        }),
      ),
    ]);

  const skusList: CatalogoSku[] = ((skus ?? []) as unknown as CatalogoSku[]).slice();
  skusList.sort((a, b) => {
    const marcaA = a.producto?.marca?.nombre ?? "";
    const marcaB = b.producto?.marca?.nombre ?? "";
    if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");
    const productoA = a.producto?.nombre ?? "";
    const productoB = b.producto?.nombre ?? "";
    if (productoA !== productoB) return productoA.localeCompare(productoB, "es");
    return a.unidades_contenidas - b.unidades_contenidas;
  });

  return (
    <NuevoInventarioForm
      sucursales={sucursalesOperables}
      categorias={categorias ?? []}
      skus={skusList}
      inventarioAbiertoPorSucursal={Object.fromEntries(abiertosPorSucursal)}
      sugeridosPorSucursal={Object.fromEntries(
        sugeridosPorSucursal.map(([id, set]) => [id, Array.from(set)]),
      )}
    />
  );
}
