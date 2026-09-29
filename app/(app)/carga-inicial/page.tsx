import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal, veCostos } from "@/lib/permisos";
import type { SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { CargaInicialForm } from "./_components/carga-inicial-form";

// La carga inicial incluye el costo, así que la ve la misma población que ve
// costos: el dueño (que es quien la hace) y el encargado de Olavarría.
// Laprida queda afuera.
export default async function CargaInicialPage() {
  const supabase = await createClient();

  if (!(await veCostos(supabase))) {
    redirect("/productos");
  }

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    redirect("/productos");
  }

  const { data: skus } = await supabase
    .from("skus")
    .select(
      `id, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
       producto:productos ( nombre, marca:marcas ( nombre ) )`,
    )
    .eq("activo", true);

  return (
    <CargaInicialForm
      sucursales={sucursalesOperables}
      skus={(skus ?? []) as unknown as SkuCatalogo[]}
    />
  );
}
