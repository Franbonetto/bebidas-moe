import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { operaCentral, operaSucursal } from "@/lib/permisos";
import { PinProvider } from "@/app/(app)/_components/pin-gate";
import { PedidoSemanalGate } from "../_components/pedido-semanal-gate";

// El pedido semanal (sugerencia + ventas de Laprida) queda detrás del PIN
// de operaciones (pedido del usuario 2026-11-05: "hay datos sensibles").
// Esta pantalla ya no trae los datos acá: el permiso de operar Laprida se
// sigue chequeando server-side antes de mostrar nada, pero la sugerencia y
// las ventas las pide PedidoSemanalGate recién con el PIN correcto (ver
// obtenerSugerenciaPedido en ../actions.ts).
export default async function NuevoPedidoPage() {
  const supabase = await createClient();

  const { data: laprida } = await supabase
    .from("sucursales")
    .select("id")
    .eq("es_central", false)
    .single();

  // Entra quien opera Laprida (arma el pedido) o quien opera Olavarría (arma
  // y despacha el envío directo, 2026-11-09).
  if (
    !laprida ||
    !((await operaSucursal(supabase, laprida.id)) || (await operaCentral(supabase)))
  ) {
    redirect("/pedidos");
  }

  return (
    <PinProvider>
      <PedidoSemanalGate />
    </PinProvider>
  );
}
