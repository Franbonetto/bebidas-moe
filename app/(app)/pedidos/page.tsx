import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { esDueno, operaSucursal, veCostos } from "@/lib/permisos";
import { PedidosTable, type PedidoRow } from "./_components/pedidos-table";
import { PedidosCompraTable, type PedidoCompraRow } from "./_components/pedidos-compra-table";

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal: sucursalParam } = await searchParams;
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre, es_central")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés ninguna sucursal asignada.
      </div>
    );
  }

  const sucursal =
    sucursalesOperables.find((s) => s.id === sucursalParam) ?? sucursalesOperables[0];

  const { data: pedidosRaw } = await supabase
    .from("pedidos")
    .select("id, numero, estado, fecha_creacion, fecha_envio, pedido_items ( cantidad_solicitada )")
    .order("fecha_creacion", { ascending: false });

  const pedidos = (pedidosRaw ?? []) as unknown as PedidoRow[];

  // El dueño solo visualiza: recibe lo que arma la encargada de cada
  // sucursal (pedido de compra a proveedores en Olavarría, pedido semanal
  // en Laprida) y ve el historial -- no arma ninguno de los dos (pedido
  // del usuario 2026-09-22: "no quiero que pueda hacer un pedido... solo
  // tiene que recibir lo que le manda la encargada").
  const esDuenoActual = await esDueno(supabase);
  const puedeCrearPedidoLaprida = !sucursal.es_central && !esDuenoActual;

  let pedidosCompra: PedidoCompraRow[] = [];
  if (sucursal.es_central && (await veCostos(supabase))) {
    const { data: pedidosCompraRaw } = await supabase
      .from("pedidos_compra")
      .select("id, numero, estado, fecha_creacion, pedidos_compra_items ( cantidad_solicitada )")
      .order("fecha_creacion", { ascending: false });
    pedidosCompra = (pedidosCompraRaw ?? []) as unknown as PedidoCompraRow[];
  }

  return (
    <div>
      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/pedidos?sucursal=${s.id}`}
              className={`rounded-[6px] border px-[10px] py-[4px] text-[12px] font-medium ${
                s.id === sucursal.id
                  ? "border-moe bg-moe-soft text-moe"
                  : "border-border bg-bg text-text-2 hover:bg-bg-2"
              }`}
            >
              {s.nombre}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {sucursal.es_central && (
          <PedidosCompraTable pedidos={pedidosCompra} puedeCrear={!esDuenoActual} />
        )}

        <PedidosTable
          pedidos={pedidos}
          puedeCrear={puedeCrearPedidoLaprida}
          agruparPorRecepcion={!sucursal.es_central}
        />
      </div>
    </div>
  );
}
