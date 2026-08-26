import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { EnvasesView } from "./_components/envases-view";
import type { MovimientoEnvaseRow, Sucursal, TipoEnvase } from "./_components/envases-view";

export default async function EnvasesPage() {
  const supabase = await createClient();

  const [{ data: sucursales }, { data: tiposEnvase }, { data: stock }, { data: movimientos }] =
    await Promise.all([
      supabase
        .from("sucursales")
        .select("id, nombre, es_central")
        .eq("activo", true)
        .order("es_central", { ascending: false }),
      supabase
        .from("tipos_envase")
        .select("id, nombre, es_generico, valor_deposito")
        .eq("activo", true)
        .order("nombre"),
      supabase.from("stock_envases").select("tipo_envase_id, sucursal_id, cantidad_vacios"),
      supabase
        .from("movimientos_envases")
        .select(
          `id, tipo, cantidad, motivo, fecha, sucursal_id,
           tipo_envase:tipos_envase ( nombre )`,
        )
        .order("fecha", { ascending: false })
        .limit(50),
    ]);

  const sucursalesList = (sucursales ?? []) as Sucursal[];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const operaSucursalMap = Object.fromEntries(sucursalesList.map((s, i) => [s.id, operables[i]]));

  return (
    <EnvasesView
      sucursales={sucursalesList}
      tiposEnvase={(tiposEnvase ?? []) as TipoEnvase[]}
      stock={stock ?? []}
      movimientos={(movimientos ?? []) as unknown as MovimientoEnvaseRow[]}
      operaSucursalMap={operaSucursalMap}
    />
  );
}
