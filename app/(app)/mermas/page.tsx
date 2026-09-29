import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import type { SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { MermaForm } from "./_components/merma-form";
import { MermasRecientes, type MermaFila } from "./_components/mermas-recientes";

// Sin guarda de rol: la merma la registra quien ve romperse la botella, en
// cualquiera de las dos sucursales. RLS (opera_sucursal) decide qué filas ve
// cada uno, y registrar_merma() vuelve a chequear el permiso de la sucursal.
export default async function MermasPage() {
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  const [{ data: skus }, { data: empleados }, { data: mermas }] = await Promise.all([
    supabase
      .from("skus")
      .select(
        `id, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
    supabase
      .from("empleados")
      .select("id, nombre, sucursal_id")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("mermas")
      .select(
        `id, cantidad, motivo, detalle, fecha,
         sucursal:sucursales ( nombre ),
         usuario:usuarios ( nombre ),
         empleado:empleados ( nombre ),
         sku:skus ( nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
                    producto:productos ( nombre, marca:marcas ( nombre ) ) )`,
      )
      .order("fecha", { ascending: false })
      .limit(40),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <MermaForm
        sucursales={sucursalesOperables}
        empleados={empleados ?? []}
        skus={(skus ?? []) as unknown as SkuCatalogo[]}
      />
      <MermasRecientes
        mermas={(mermas ?? []) as unknown as MermaFila[]}
        variasSucursales={sucursalesOperables.length > 1}
      />
    </div>
  );
}
