import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { operaSucursal, veCostos } from "@/lib/permisos";
import type { SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { CargaInicialForm } from "./_components/carga-inicial-form";
import { CargaInicialLapridaForm } from "./_components/carga-inicial-laprida-form";
import { PinProvider } from "@/app/(app)/_components/pin-gate";

// La carga inicial con costo la ve la misma población que ve costos: el
// dueño (que es quien la hace) y el encargado de Olavarría. El encargado de
// Laprida tiene su propia versión, reducida a la cantidad contada
// (20261102090000_carga_inicial_laprida.sql) -- nunca ve costo ni precio
// acá (CLAUDE.md, matriz de roles).
export default async function CargaInicialPage() {
  const supabase = await createClient();
  const puedeCostos = await veCostos(supabase);

  const { data: sucursales } = await traerTodo(
    supabase
      .from("sucursales")
      .select("id, nombre, es_central")
      .eq("activo", true)
      .order("es_central", { ascending: false }),
  );
  const sucursalesList = sucursales ?? [];

  if (puedeCostos) {
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

  // Sin ve_costos(): solo entra quien opera la sucursal satélite (Laprida).
  const sucursalLaprida = sucursalesList.find((s) => !s.es_central);
  const puedeLaprida = sucursalLaprida ? await operaSucursal(supabase, sucursalLaprida.id) : false;

  if (!sucursalLaprida || !puedeLaprida) {
    redirect("/productos");
  }

  const { data: skus } = await traerTodo(
    supabase
      .from("skus")
      .select(
        `id, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
  );

  return (
    <PinProvider>
      <CargaInicialLapridaForm
        sucursalId={sucursalLaprida.id}
        sucursalNombre={sucursalLaprida.nombre}
        skus={(skus ?? []) as unknown as SkuCatalogo[]}
      />
    </PinProvider>
  );
}
