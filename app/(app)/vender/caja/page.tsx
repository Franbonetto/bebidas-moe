import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { CerrarCajaForm } from "./_components/cerrar-caja-form";
import { formatoMoneda } from "../_lib/formato";

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal: sucursalParam } = await searchParams;
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
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

  const { data: caja } = await supabase
    .from("cajas")
    .select("id, estado, monto_apertura, efectivo_sistema, efectivo_declarado, diferencia, cantidad_tickets")
    .eq("sucursal_id", sucursal.id)
    .eq("fecha", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  // Desglose por medio: sale de venta_pagos, no de ventas.medio_pago/total
  // -- una venta "mixta" (pago dividido, ver
  // 20260919100000_venta_pagos.sql) puede tener una porción real en
  // efectivo aunque no haya tenido el descuento de efectivo.
  const { data: ventaIdsHoy } = caja?.id
    ? await supabase.from("ventas").select("id").eq("caja_id", caja.id).eq("estado", "confirmada")
    : { data: [] };

  const idsVentasHoy = (ventaIdsHoy ?? []).map((v) => v.id);

  const { data: pagosHoy } = idsVentasHoy.length > 0
    ? await supabase.from("venta_pagos").select("medio_pago, monto").in("venta_id", idsVentasHoy)
    : { data: [] };

  const { data: movimientosHoy } = caja?.id
    ? await supabase.from("movimientos_caja").select("tipo, monto").eq("caja_id", caja.id)
    : { data: [] };

  const cantidadVentasHoy = idsVentasHoy.length;

  // Devoluciones en dinero contra ESTA caja (arquitectura.md 1.10 +
  // supabase/migrations/20260904090000_devoluciones_cliente.sql): hay que
  // restarlas del efectivo esperado, mismo criterio que ya aplica
  // cerrar_caja() -- si no se muestra acá, el encargado ve un numero
  // distinto mientras la caja sigue abierta que el que va a quedar al
  // cerrarla.
  const { data: devolucionesHoy } = caja?.id
    ? await supabase
        .from("devoluciones")
        .select("monto_reembolsado")
        .eq("caja_id", caja.id)
        .eq("resolucion", "dinero")
    : { data: [] };

  const totalPorMedio = new Map<string, number>();
  let totalGeneral = 0;
  for (const p of (pagosHoy ?? []) as unknown as { medio_pago: string; monto: number }[]) {
    totalPorMedio.set(p.medio_pago, (totalPorMedio.get(p.medio_pago) ?? 0) + p.monto);
    totalGeneral += p.monto;
  }

  const devolucionesDineroTotal = (devolucionesHoy ?? []).reduce(
    (acc, d) => acc + (d.monto_reembolsado ?? 0),
    0,
  );

  let entradasTotal = 0;
  let salidasTotal = 0;
  for (const m of (movimientosHoy ?? []) as { tipo: string; monto: number }[]) {
    if (m.tipo === "entrada") entradasTotal += m.monto;
    else salidasTotal += m.monto;
  }

  return (
    <div className="mx-auto max-w-[560px]">
      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/vender/caja?sucursal=${s.id}`}
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

      <div className="rounded-card border border-border bg-bg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[15px] font-semibold text-text">Caja del día — {sucursal.nombre}</h1>
          <Link href="/vender" className="text-[12.5px] text-text-2 hover:text-text">
            ← Volver a vender
          </Link>
        </div>

        {!caja ? (
          <p className="text-[13px] text-text-2">
            Todavía no se abrió la caja hoy —{" "}
            <Link href="/vender" className="text-moe hover:underline">
              abrila desde la pantalla de vender
            </Link>
            .
          </p>
        ) : (
          <>
            <div className="mb-3 flex justify-between rounded-[6px] bg-bg-2 px-[12px] py-[7px] text-[13px]">
              <span className="text-text-2">Monto de apertura</span>
              <span className="tabular-nums text-text">{formatoMoneda.format(caja.monto_apertura ?? 0)}</span>
            </div>

            <div className="mb-4 overflow-hidden rounded-[6px] border border-border">
              {Object.entries(MEDIO_LABEL).map(([id, label]) => (
                <div
                  key={id}
                  className="flex justify-between border-b border-[#F1F1F3] px-[12px] py-[7px] text-[13px] last:border-b-0"
                >
                  <span className="text-text-2">{label}</span>
                  <span className="tabular-nums text-text">
                    {formatoMoneda.format(totalPorMedio.get(id) ?? 0)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between bg-bg-2 px-[12px] py-[7px] text-[13px] font-semibold">
                <span className="text-text">Total del día</span>
                <span className="tabular-nums text-text">{formatoMoneda.format(totalGeneral)}</span>
              </div>
            </div>

            {devolucionesDineroTotal > 0 && (
              <div className="mb-2 flex justify-between rounded-[6px] bg-warn-bg px-[12px] py-[7px] text-[13px] text-warn">
                <span>Devoluciones en dinero</span>
                <span className="tabular-nums">−{formatoMoneda.format(devolucionesDineroTotal)}</span>
              </div>
            )}

            {(entradasTotal > 0 || salidasTotal > 0) && (
              <div className="mb-2 flex flex-col gap-1 rounded-[6px] bg-bg-2 px-[12px] py-[7px] text-[13px]">
                {entradasTotal > 0 && (
                  <div className="flex justify-between text-text-2">
                    <span>Entradas de efectivo</span>
                    <span className="tabular-nums text-ok">+{formatoMoneda.format(entradasTotal)}</span>
                  </div>
                )}
                {salidasTotal > 0 && (
                  <div className="flex justify-between text-text-2">
                    <span>Salidas de efectivo</span>
                    <span className="tabular-nums text-err">−{formatoMoneda.format(salidasTotal)}</span>
                  </div>
                )}
              </div>
            )}

            <p className="mb-4 text-[12.5px] text-text-3">
              {caja.cantidad_tickets ?? cantidadVentasHoy ?? 0} ticket(s) hoy.
            </p>

            {caja.estado === "abierta" ? (
              <CerrarCajaForm
                cajaId={caja.id}
                efectivoEsperado={
                  (caja.monto_apertura ?? 0) +
                  (totalPorMedio.get("efectivo") ?? 0) -
                  devolucionesDineroTotal +
                  entradasTotal -
                  salidasTotal
                }
              />
            ) : (
              <div className="rounded-[6px] bg-bg-2 p-[12px] text-[13px]">
                <p className="mb-1 flex justify-between">
                  <span className="text-text-2">Efectivo según sistema (apertura + ventas − devoluciones ± entradas/salidas)</span>
                  <span className="tabular-nums text-text">
                    {formatoMoneda.format(caja.efectivo_sistema ?? 0)}
                  </span>
                </p>
                <p className="mb-1 flex justify-between">
                  <span className="text-text-2">Efectivo declarado</span>
                  <span className="tabular-nums text-text">
                    {formatoMoneda.format(caja.efectivo_declarado ?? 0)}
                  </span>
                </p>
                <p className="flex justify-between font-medium">
                  <span className="text-text-2">Diferencia</span>
                  <span
                    className={`tabular-nums ${
                      (caja.diferencia ?? 0) === 0
                        ? "text-ok"
                        : (caja.diferencia ?? 0) < 0
                          ? "text-err"
                          : "text-warn"
                    }`}
                  >
                    {formatoMoneda.format(caja.diferencia ?? 0)}
                  </span>
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
