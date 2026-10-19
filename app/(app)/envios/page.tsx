import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { operaSucursal, esDueno, veCostos } from "@/lib/permisos";
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

  const { data: sucursales } = await traerTodo(
    supabase
      .from("sucursales")
      .select("id, nombre, es_central")
      .eq("activo", true)
      .order("es_central", { ascending: false }),
  );

  const sucursalesList = sucursales ?? [];

  // El dueño no arma envíos (no opera el mostrador, arquitectura.md 1.11),
  // pero sí necesita ver el historial de las dos sucursales -- mismo
  // criterio de "lectura" que el resto de su panel.
  if (await esDueno(supabase)) {
    const desde = new Date();
    desde.setDate(desde.getDate() - 60);

    // Sin tope de filas: el .limit(300) escondia envios dentro de la misma
    // ventana de 60 dias que la pantalla dice estar mostrando.
    const { data: enviosRaw } = await traerTodo(
      supabase
        .from("ventas")
        .select(
          `id, fecha, total, medio_pago, motomandado, direccion_envio, envio_pagado,
           sucursal:sucursales ( nombre ),
           venta_pagos ( medio_pago, monto )`,
        )
        .eq("es_envio", true)
        .eq("estado", "confirmada")
        .gte("fecha", desde.toISOString())
        .order("fecha", { ascending: false }),
    );

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
      envio_pagado: boolean | null;
      sucursal: { nombre: string } | null;
      venta_pagos: { medio_pago: string; monto: number }[];
    }[]).map((v) => ({
      id: v.id,
      fecha: v.fecha,
      total: v.total,
      sucursalNombre: v.sucursal?.nombre ?? "—",
      motomandado: v.motomandado ?? "—",
      direccionEnvio: v.direccion_envio ?? "—",
      pagado: v.envio_pagado,
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

  // Mismo criterio que /vender: el costo solo viaja al navegador de quien
  // ya lo ve en pantalla, para poder advertir si un precio escrito a mano
  // queda bajo el costo (2026-10-17).
  const puedeTocarPrecios = await veCostos(supabase);

  const { skusPos, combos, promosCantidad, puedeFacturar, cajaHoy, cantidadTicketsHoy } =
    await cargarDatosVenta(supabase, sucursal, { incluirCosto: puedeTocarPrecios });

  // Envíos usa el mismo POS, así que también necesita la caja abierta y, con
  // ella, quién la abre.
  const { data: empleados } = await traerTodo(
    supabase
      .from("empleados")
      .select("id, nombre")
      .eq("sucursal_id", sucursal.id)
      .eq("activo", true)
      .order("nombre"),
  );

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
        puedeTocarPrecios={puedeTocarPrecios}
        skus={skusPos}
        combos={combos}
        promosCantidad={promosCantidad}
        estadoCaja={!cajaHoy ? "sin_abrir" : cajaHoy.estado === "abierta" ? "abierta" : "cerrada"}
        cajaId={cajaHoy?.id ?? null}
        cantidadTicketsHoy={cantidadTicketsHoy}
        empleados={empleados ?? []}
        modoEnvio
      />
    </div>
  );
}
