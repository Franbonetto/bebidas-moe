import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { PedidosTable, type PedidoRow } from "./_components/pedidos-table";

export default async function PedidosPage() {
  const supabase = await createClient();

  const { data: laprida } = await supabase
    .from("sucursales")
    .select("id")
    .eq("es_central", false)
    .single();

  const [{ data: pedidos }, puedeCrear] = await Promise.all([
    supabase
      .from("pedidos")
      .select("id, numero, estado, fecha_creacion, fecha_envio, pedido_items ( cantidad_solicitada )")
      .order("fecha_creacion", { ascending: false }),
    laprida ? operaSucursal(supabase, laprida.id) : Promise.resolve(false),
  ]);

  return (
    <PedidosTable pedidos={(pedidos ?? []) as unknown as PedidoRow[]} puedeCrear={puedeCrear} />
  );
}
