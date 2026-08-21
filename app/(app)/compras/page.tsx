import { createClient } from "@/lib/supabase/server";
import { ComprasTable, type Compra } from "./_components/compras-table";

export default async function ComprasPage() {
  const supabase = await createClient();

  const { data: compras } = await supabase
    .from("compras")
    .select(
      "id, numero_factura, fecha_factura, estado, total, proveedor:proveedores ( razon_social, nombre_comercial )",
    )
    .order("fecha_factura", { ascending: false, nullsFirst: false });

  return <ComprasTable compras={(compras ?? []) as unknown as Compra[]} />;
}
