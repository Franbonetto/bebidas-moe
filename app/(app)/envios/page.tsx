import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal, esDueno } from "@/lib/permisos";
import { cargarDatosVenta } from "../vender/_lib/cargar-datos-venta";
import { PosClient } from "../vender/_components/pos-client";
import { EnviosHistorialTable, type EnvioRow } from "./_components/envios-historial-table";

export default async function EnviosPage({
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

  // El dueño no arma envíos (no opera el mostrador, arquitectura.md 1.11),
  // pero sí necesita ver el historial de las dos sucursales -- mismo
  // criterio de "lectura" que el resto de su panel.
  if (await esDueno(supabase)) {
    const desde = new Date();
    desde.setDate(desde.getDate() - 60);

    const { data: enviosRaw } = await supabase
      .from("ventas")
      .select(
        `id, fecha, total, medio_pago, motomandado, direccion_envio,
         sucursal:sucursales ( nombre ),
         venta_pagos ( medio_pago, monto )`,
      )
      .eq("es_envio", true)
      .eq("estado", "confirmada")
      .gte("fecha", desde.toISOString())
      .order("fecha", { ascending: false })
      .limit(300);

    const MEDIO_LABEL: Record<string, string> = {
      efectivo: "Efectivo",
      debito: "Débito",
      credito: "Crédito",
      transferencia: "Transferencia",
      qr: "QR",
      mixto: "Pago combinado",
    };

    const envios: EnvioRow[] = ((enviosRaw ?? []) as unknown as {
      id: string;
      fecha: string;
      total: number;
      medio_pago: string;
      motomandado: string | null;
      direccion_envio: string | null;
      sucursal: { nombre: string } | null;
      venta_pagos: { medio_pago: string; monto: number }[];
    }[]).map((v) => ({
      id: v.id,
      fecha: v.fecha,
      total: v.total,
      sucursalNombre: v.sucursal?.nombre ?? "—",
      motomandado: v.motomandado ?? "—",
      direccionEnvio: v.direccion_envio ?? "—",
      medioPagoLabel:
        v.medio_pago === "mixto"
          ? v.venta_pagos.map((p) => MEDIO_LABEL[p.medio_pago] ?? p.medio_pago).join(" + ")
          : (MEDIO_LABEL[v.medio_pago] ?? v.medio_pago),
    }));

    return <EnviosHistorialTable envios={envios} />;
  }

  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés ninguna sucursal asignada para cargar envíos.
      </div>
    );
  }

  const sucursal = sucursalesOperables.find((s) => s.id === sucursalParam) ?? sucursalesOperables[0];

  const { skusPos, combos, promosCantidad, puedeFacturar, cajaHoy, cantidadTicketsHoy } =
    await cargarDatosVenta(supabase, sucursal);

  return (
    <div>
      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/envios?sucursal=${s.id}`}
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
        estadoCaja={!cajaHoy ? "sin_abrir" : cajaHoy.estado === "abierta" ? "abierta" : "cerrada"}
        cajaId={cajaHoy?.id ?? null}
        cantidadTicketsHoy={cantidadTicketsHoy}
        modoEnvio
      />
    </div>
  );
}
