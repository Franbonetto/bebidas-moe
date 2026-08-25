import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { InventariosTable, type InventarioRow } from "./_components/inventarios-table";

export default async function InventariosPage() {
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(
    sucursalesList.map((s) => operaSucursal(supabase, s.id)),
  );
  const sucursalIdsOperables = sucursalesList
    .filter((_, i) => operables[i])
    .map((s) => s.id);

  const { data: inventarios } = sucursalIdsOperables.length
    ? await supabase
        .from("inventarios")
        .select(
          `id, tipo, estado, fecha_inicio, fecha_fin,
           sucursal:sucursales ( nombre ),
           categoria:categorias ( nombre ),
           inventario_items ( diferencia )`,
        )
        .in("sucursal_id", sucursalIdsOperables)
        .order("fecha_inicio", { ascending: false })
    : { data: [] };

  return (
    <InventariosTable
      inventarios={(inventarios ?? []) as unknown as InventarioRow[]}
      puedeCrear={sucursalIdsOperables.length > 0}
    />
  );
}
