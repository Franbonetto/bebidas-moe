import { createClient } from "@/lib/supabase/server";
import { esDueno } from "@/lib/permisos";
import { ComprasTable, type Compra } from "./_components/compras-table";

export default async function ComprasPage() {
  const supabase = await createClient();

  const [{ data: compras }, puedeCargar] = await Promise.all([
    supabase
      .from("compras")
      .select(
        "id, numero_factura, fecha_factura, estado, total, proveedor:proveedores ( razon_social, nombre_comercial )",
      )
      .order("fecha_factura", { ascending: false, nullsFirst: false }),
    esDueno(supabase).then((esDuenoActual) => !esDuenoActual),
  ]);

  return <ComprasTable compras={(compras ?? []) as unknown as Compra[]} puedeCargar={puedeCargar} />;
}
