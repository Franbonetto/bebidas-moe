import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { operaSucursal, veCostos } from "@/lib/permisos";
import type { SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { CargaInicialForm } from "./_components/carga-inicial-form";
import { PinProvider } from "@/app/(app)/_components/pin-gate";

// La carga inicial incluye el costo, así que la ve la misma población que ve
// costos: el dueño (que es quien la hace) y el encargado de Olavarría.
// Laprida queda afuera.
export default async function CargaInicialPage() {
  const supabase = await createClient();

  if (!(await veCostos(supabase))) {
    redirect("/productos");
  }

  const { data: sucursales } = await traerTodo(
    supabase
      .from("sucursales")
      .select("id, nombre")
      .eq("activo", true)
      .order("es_central", { ascending: false }),
  );

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    redirect("/productos");
  }

  const [{ data: skus }, { data: proveedores }] = await Promise.all([
    traerTodo(
      supabase
        .from("skus")
        .select(
          `id, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           producto:productos ( nombre, marca:marcas ( nombre ) )`,
        )
        .eq("activo", true),
    ),
    traerTodo(
      supabase
        .from("proveedores")
        .select("id, razon_social, nombre_comercial")
        .eq("activo", true)
        .order("razon_social"),
    ),
  ]);

  return (
    <PinProvider>
      <CargaInicialForm
        sucursales={sucursalesOperables}
        proveedores={proveedores ?? []}
        skus={(skus ?? []) as unknown as SkuCatalogo[]}
      />
    </PinProvider>
  );
}
