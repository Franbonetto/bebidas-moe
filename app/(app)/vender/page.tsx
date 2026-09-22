import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { cargarDatosVenta } from "./_lib/cargar-datos-venta";
import { PosClient } from "./_components/pos-client";

export default async function VenderPage({
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
        No tenés ninguna sucursal asignada para vender.
      </div>
    );
  }

  const sucursal =
    sucursalesOperables.find((s) => s.id === sucursalParam) ?? sucursalesOperables[0];

  const { skusPos, combos, promosCantidad, puedeFacturar, cajaHoy, cantidadTicketsHoy } =
    await cargarDatosVenta(supabase, sucursal);

  return (
    <div>
      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/vender?sucursal=${s.id}`}
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

      <PosClient
        sucursalId={sucursal.id}
        sucursalNombre={sucursal.nombre}
        puedeFacturar={puedeFacturar}
        skus={skusPos}
        combos={combos}
        promosCantidad={promosCantidad}
        // Apertura de caja obligatoria antes de vender: sin fila de hoy
        // todavia no se abrio (antes se abria sola con la primera venta,
        // ver supabase/migrations/20260903100000_apertura_caja.sql).
        estadoCaja={!cajaHoy ? "sin_abrir" : cajaHoy.estado === "abierta" ? "abierta" : "cerrada"}
        cajaId={cajaHoy?.id ?? null}
        cantidadTicketsHoy={cantidadTicketsHoy}
      />
    </div>
  );
}
