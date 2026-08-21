import { createClient } from "@/lib/supabase/server";
import { ProveedoresTable, type Proveedor } from "./_components/proveedores-table";

export default async function ProveedoresPage() {
  const supabase = await createClient();

  const { data: proveedores } = await supabase
    .from("proveedores")
    .select(
      "id, razon_social, nombre_comercial, cuit, contacto, whatsapp, email, direccion, condicion_pago, plazo_dias, observaciones, activo",
    )
    .order("razon_social");

  return <ProveedoresTable proveedores={(proveedores ?? []) as Proveedor[]} />;
}
