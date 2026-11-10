import { Fragment } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase/traer-todo";
import { ZONA_ARGENTINA } from "@/lib/fecha";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import {
  BarRow,
  Card,
  EmptyState,
  Kpi,
  KpiGrid,
  SectionHeader,
} from "@/app/(app)/_components/dashboard/ui";
import { Tabla, Td, Th, Tr } from "../../_components/tabla";
import { fechaDelDia } from "../_lib/dia";

// La caja de un RANGO de días de una sucursal (pedido del usuario
// 2026-11-09: cerrar de lunes a lunes, o los días que elija, y ver la caja
// discriminada con todos los medios de pago).
//
// Mismo criterio que la caja de un día (caja-dia.tsx): una venta pertenece a
// la caja que estaba abierta cuando se hizo (`ventas.caja_id`), no a un rango
// de horas, y la plata por medio sale de `venta_pagos` -- un pago dividido
// suma en cada uno de sus medios.

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  qr: "QR",
  mercado_pago: "Mercado Pago",
  cuenta_dni: "Cuenta DNI",
};

// Se muestran siempre todos, con 0 si no se usaron: lo que se pide es ver la
// caja completa, no solo lo que tuvo movimiento. Cualquier medio que no esté
// en esta lista y aparezca en los datos se agrega al final.
const MEDIOS_FIJOS = Object.keys(MEDIO_LABEL);

const formatoDiaCorto = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: ZONA_ARGENTINA,
});

type CajaFila = {
  id: string;
  fecha: string;
  estado: "abierta" | "cerrada";
  monto_apertura: number | null;
  efectivo_sistema: number | null;
  efectivo_declarado: number | null;
  diferencia: number | null;
  cantidad_tickets: number | null;
  empleado_apertura: { nombre: string } | { nombre: string }[] | null;
  empleado_cierre: { nombre: string } | { nombre: string }[] | null;
};

function nombreRel(rel: { nombre: string } | { nombre: string }[] | null): string | null {
  const fila = Array.isArray(rel) ? rel[0] : rel;
  return fila?.nombre ?? null;
}

function etiquetaDia(dia: string) {
  return formatoDiaCorto.format(fechaDelDia(dia));
}

export async function CajaRango({
  supabase,
  desde,
  hasta,
  sucursalId,
  sucursalNombre,
}: {
  supabase: SupabaseClient;
  desde: string;
  hasta: string;
  sucursalId: string;
  sucursalNombre: string;
}) {
  const { data: cajasRaw } = await traerTodo(
    supabase
      .from("cajas")
      .select(
        `id, fecha, estado, monto_apertura, efectivo_sistema, efectivo_declarado,
         diferencia, cantidad_tickets,
         empleado_apertura:empleados!cajas_empleado_apertura_id_fkey ( nombre ),
         empleado_cierre:empleados!cajas_empleado_cierre_id_fkey ( nombre )`,
      )
      .eq("sucursal_id", sucursalId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true }),
  );

  const cajas = (cajasRaw ?? []) as unknown as CajaFila[];
  const idsCajas = cajas.map((c) => c.id);

  if (idsCajas.length === 0) {
    return (
      <Card title="Sin cajas en esas fechas">
        <EmptyState
          title="No se abrió ninguna caja"
          sub={`En ${sucursalNombre} no hubo caja abierta entre esos días, así que tampoco hubo ventas. Probá con otras fechas o con la otra sucursal.`}
        />
      </Card>
    );
  }

  const { data: ventasRaw } = await traerTodo(
    supabase
      .from("ventas")
      .select("id, caja_id, total, es_envio")
      .in("caja_id", idsCajas)
      .eq("estado", "confirmada"),
  );
  const ventas = (ventasRaw ?? []) as { id: string; caja_id: string; total: number; es_envio: boolean }[];
  const idsVentas = ventas.map((v) => v.id);

  const [{ data: pagosRaw }, { data: movimientosRaw }, { data: devolucionesRaw }] = await Promise.all([
    idsVentas.length
      ? traerTodoPorLotes<{ venta_id: string; medio_pago: string; monto: number }>(idsVentas, (lote) =>
          supabase.from("venta_pagos").select("venta_id, medio_pago, monto").in("venta_id", lote),
        )
      : Promise.resolve({ data: [], error: null }),
    traerTodo(
      supabase.from("movimientos_caja").select("caja_id, tipo, monto").in("caja_id", idsCajas),
    ),
    traerTodo(
      supabase
        .from("devoluciones")
        .select("caja_id, resolucion, medio_reembolso, monto_reembolsado")
        .in("caja_id", idsCajas),
    ),
  ]);

  // --- Plata por día y por medio --------------------------------------
  const fechaDeCaja = new Map(cajas.map((c) => [c.id, c.fecha]));
  const cajaDeVenta = new Map(ventas.map((v) => [v.id, v.caja_id]));

  const porDia = new Map<string, Map<string, number>>();
  const totalPorMedio = new Map<string, number>();
  for (const p of pagosRaw ?? []) {
    const cajaId = cajaDeVenta.get(p.venta_id);
    const dia = cajaId ? fechaDeCaja.get(cajaId) : undefined;
    if (!dia) continue;
    const monto = Number(p.monto);
    const delDia = porDia.get(dia) ?? new Map<string, number>();
    delDia.set(p.medio_pago, (delDia.get(p.medio_pago) ?? 0) + monto);
    porDia.set(dia, delDia);
    totalPorMedio.set(p.medio_pago, (totalPorMedio.get(p.medio_pago) ?? 0) + monto);
  }

  const mediosExtra = [...totalPorMedio.keys()].filter((m) => !MEDIOS_FIJOS.includes(m));
  const medios = [...MEDIOS_FIJOS, ...mediosExtra];
  const labelMedio = (m: string) => MEDIO_LABEL[m] ?? m;

  const dias = [...new Set(cajas.map((c) => c.fecha))].sort();
  const totalCobrado = [...totalPorMedio.values()].reduce((a, b) => a + b, 0);
  const maxMedio = Math.max(0, ...totalPorMedio.values());
  const mediosOrdenados = medios
    .map((m) => [m, totalPorMedio.get(m) ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);

  const vendido = ventas.reduce((acc, v) => acc + Number(v.total), 0);
  const tickets = ventas.length;
  const envios = ventas.filter((v) => v.es_envio);
  const enviosTotal = envios.reduce((acc, v) => acc + Number(v.total), 0);

  // --- Arqueo, salidas y devoluciones ---------------------------------
  const cerradas = cajas.filter((c) => c.estado === "cerrada" && c.diferencia != null);
  const diferenciaTotal = cerradas.reduce((acc, c) => acc + Number(c.diferencia), 0);
  const sistemaTotal = cajas.reduce((acc, c) => acc + Number(c.efectivo_sistema ?? 0), 0);
  const declaradoTotal = cajas.reduce((acc, c) => acc + Number(c.efectivo_declarado ?? 0), 0);
  const ticketsCajas = cajas.reduce((acc, c) => acc + Number(c.cantidad_tickets ?? 0), 0);

  const movimientos = (movimientosRaw ?? []) as { caja_id: string; tipo: string; monto: number }[];
  const salidas = movimientos
    .filter((m) => m.tipo === "salida")
    .reduce((acc, m) => acc + Number(m.monto), 0);
  const entradas = movimientos
    .filter((m) => m.tipo === "entrada")
    .reduce((acc, m) => acc + Number(m.monto), 0);

  const devoluciones = (devolucionesRaw ?? []) as {
    caja_id: string;
    resolucion: string;
    medio_reembolso: string | null;
    monto_reembolsado: number | null;
  }[];
  const devueltoDinero = devoluciones
    .filter((d) => d.resolucion === "dinero")
    .reduce((acc, d) => acc + Number(d.monto_reembolsado ?? 0), 0);
  const devueltoEfectivo = devoluciones
    .filter((d) => d.resolucion === "dinero" && d.medio_reembolso === "efectivo")
    .reduce((acc, d) => acc + Number(d.monto_reembolsado ?? 0), 0);

  // --- Egresos de efectivo (pedido del usuario 2026-11-10) -------------
  // Lo que salió del cajón en efectivo: salidas de caja + devoluciones
  // pagadas en efectivo (las de posnet/transferencia/QR no tocan el cajón).
  // Mismo criterio que cerrar_caja() para el efectivo esperado. Cada egreso
  // va al día de la caja en la que ocurrió. Las entradas no se suman al neto.
  const egresosPorDia = new Map<string, number>();
  const sumarEgreso = (cajaId: string, monto: number) => {
    const dia = fechaDeCaja.get(cajaId);
    if (!dia) return;
    egresosPorDia.set(dia, (egresosPorDia.get(dia) ?? 0) + monto);
  };
  for (const m of movimientos) {
    if (m.tipo === "salida") sumarEgreso(m.caja_id, Number(m.monto));
  }
  for (const d of devoluciones) {
    if (d.resolucion === "dinero" && d.medio_reembolso === "efectivo") {
      sumarEgreso(d.caja_id, Number(d.monto_reembolsado ?? 0));
    }
  }
  const egresosEfectivo = salidas + devueltoEfectivo;
  const efectivoCobrado = totalPorMedio.get("efectivo") ?? 0;
  const efectivoNeto = efectivoCobrado - egresosEfectivo;

  const abiertas = cajas.length - cerradas.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeader
          title="Resumen del efectivo"
          meta="Lo cobrado en billete menos lo que salió del cajón"
        />
        <KpiGrid>
          <Kpi label="Efectivo cobrado" value={formatoMoneda.format(efectivoCobrado)} />
          <Kpi
            label="Egresos de efectivo"
            value={formatoMoneda.format(egresosEfectivo)}
            sub={`${formatoMoneda.format(salidas)} de salidas de caja · ${formatoMoneda.format(devueltoEfectivo)} de devoluciones en efectivo`}
          />
          <Kpi label="Efectivo neto" value={formatoMoneda.format(efectivoNeto)} sub="Cobrado menos egresos" />
        </KpiGrid>
      </div>

      <KpiGrid>
        <Kpi
          label="Vendido"
          value={formatoMoneda.format(vendido)}
          sub={`${tickets} ticket${tickets === 1 ? "" : "s"} en ${dias.length} día${dias.length === 1 ? "" : "s"} con caja`}
        />
        <Kpi
          label="Diferencia de caja"
          value={cerradas.length === 0 ? "—" : formatoMoneda.format(diferenciaTotal)}
          sub={
            cerradas.length === 0
              ? "Ninguna caja cerrada todavía"
              : `${cerradas.length} de ${cajas.length} caja${cajas.length === 1 ? "" : "s"} cerrada${cerradas.length === 1 ? "" : "s"}`
          }
        />
        <Kpi
          label="Salidas del cajón"
          value={formatoMoneda.format(salidas)}
          sub={entradas > 0 ? `${formatoMoneda.format(entradas)} de entradas` : "Sin entradas"}
        />
        <Kpi
          label="Devoluciones de dinero"
          value={formatoMoneda.format(devueltoDinero)}
          sub={`${formatoMoneda.format(devueltoEfectivo)} salieron del cajón`}
        />
      </KpiGrid>

      <div>
        <SectionHeader
          title="Medios de pago, día por día"
          meta="Cada pago en su medio: uno dividido suma en los dos"
        />
        <Card title={`${formatoMoneda.format(totalCobrado)} cobrados en ${sucursalNombre}`}>
          <Tabla>
            <thead>
              <tr>
                <Th>Día</Th>
                {medios.map((m) => (
                  <Fragment key={m}>
                    <Th align="right">{labelMedio(m)}</Th>
                    {m === "efectivo" && <Th align="right">Egresos efectivo</Th>}
                  </Fragment>
                ))}
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {dias.map((dia) => {
                const delDia = porDia.get(dia);
                const totalDia = delDia ? [...delDia.values()].reduce((a, b) => a + b, 0) : 0;
                return (
                  <Tr key={dia}>
                    <Td>
                      <Link
                        href={`/reportes/caja?dia=${dia}&sucursal=${sucursalId}`}
                        className="font-medium capitalize text-moe hover:underline"
                      >
                        {etiquetaDia(dia)}
                      </Link>
                    </Td>
                    {medios.map((m) => {
                      const monto = delDia?.get(m) ?? 0;
                      const egreso = egresosPorDia.get(dia) ?? 0;
                      return (
                        <Fragment key={m}>
                          <Td align="right" numero mute={monto === 0}>
                            {monto === 0 ? "—" : formatoMoneda.format(monto)}
                          </Td>
                          {m === "efectivo" && (
                            <Td align="right" numero mute={egreso === 0}>
                              {egreso === 0 ? "—" : `−${formatoMoneda.format(egreso)}`}
                            </Td>
                          )}
                        </Fragment>
                      );
                    })}
                    <Td align="right" numero>
                      <span className="font-medium text-text">{formatoMoneda.format(totalDia)}</span>
                    </Td>
                  </Tr>
                );
              })}
              <Tr total>
                <Td>Total del período</Td>
                {medios.map((m) => {
                  const monto = totalPorMedio.get(m) ?? 0;
                  return (
                    <Fragment key={m}>
                      <Td align="right" numero mute={monto === 0}>
                        {monto === 0 ? "—" : formatoMoneda.format(monto)}
                      </Td>
                      {m === "efectivo" && (
                        <Td align="right" numero mute={egresosEfectivo === 0}>
                          {egresosEfectivo === 0 ? "—" : `−${formatoMoneda.format(egresosEfectivo)}`}
                        </Td>
                      )}
                    </Fragment>
                  );
                })}
                <Td align="right" numero>
                  {formatoMoneda.format(totalCobrado)}
                </Td>
              </Tr>
            </tbody>
          </Tabla>
          {envios.length > 0 && (
            <p className="border-t border-border px-[14px] py-[9px] text-[11.5px] text-text-3">
              De ese total, {envios.length} envío{envios.length === 1 ? "" : "s"} por{" "}
              {formatoMoneda.format(enviosTotal)} — ya contados en su medio de pago, no son una caja
              aparte.
            </p>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader title="Con qué pagaron en total" meta="De mayor a menor" />
        <Card title="Medios de pago del período">
          {totalCobrado === 0 ? (
            <EmptyState title="Sin cobros" sub="No hubo ventas confirmadas en esas fechas." />
          ) : (
            <div className="flex flex-col gap-[9px] px-[14px] py-[13px]">
              {mediosOrdenados.map(([medio, monto]) => (
                <BarRow
                  key={medio}
                  label={labelMedio(medio)}
                  value={monto}
                  max={maxMedio}
                  display={formatoMoneda.format(monto)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Arqueo del efectivo"
          meta="Tocá un día para ver esa caja completa: ventas y productos"
        />
        <Card title={`${cajas.length} caja${cajas.length === 1 ? "" : "s"} en el período`}>
          <Tabla>
            <thead>
              <tr>
                <Th>Día</Th>
                <Th>Abrió</Th>
                <Th>Cerró</Th>
                <Th align="right">Apertura</Th>
                <Th align="right">Según sistema</Th>
                <Th align="right">Contado</Th>
                <Th align="right">Diferencia</Th>
                <Th align="right">Tickets</Th>
              </tr>
            </thead>
            <tbody>
              {cajas.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link
                      href={`/reportes/caja?dia=${c.fecha}&sucursal=${sucursalId}`}
                      className="font-medium capitalize text-moe hover:underline"
                    >
                      {etiquetaDia(c.fecha)}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-medium text-text">
                      {nombreRel(c.empleado_apertura) ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    {c.estado === "abierta" ? (
                      <span className="rounded-[5px] bg-ok-bg px-[7px] py-[2px] text-[11px] font-medium text-ok">
                        Abierta
                      </span>
                    ) : (
                      <span className="font-medium text-text">
                        {nombreRel(c.empleado_cierre) ?? "—"}
                      </span>
                    )}
                  </Td>
                  <Td align="right" numero>
                    {formatoMoneda.format(c.monto_apertura ?? 0)}
                  </Td>
                  <Td align="right" numero mute={c.efectivo_sistema == null}>
                    {c.efectivo_sistema == null ? "—" : formatoMoneda.format(c.efectivo_sistema)}
                  </Td>
                  <Td align="right" numero mute={c.efectivo_declarado == null}>
                    {c.efectivo_declarado == null ? "—" : formatoMoneda.format(c.efectivo_declarado)}
                  </Td>
                  <Td align="right" numero>
                    {c.diferencia == null ? (
                      <span className="text-text-3">—</span>
                    ) : (
                      <span
                        className={
                          c.diferencia === 0 ? "text-ok" : c.diferencia < 0 ? "text-err" : "text-warn"
                        }
                      >
                        {formatoMoneda.format(c.diferencia)}
                      </span>
                    )}
                  </Td>
                  <Td align="right" numero>
                    {c.cantidad_tickets ?? "—"}
                  </Td>
                </Tr>
              ))}
              <Tr total>
                <Td>Total del período</Td>
                <Td />
                <Td />
                <Td align="right" />
                <Td align="right" numero>
                  {formatoMoneda.format(sistemaTotal)}
                </Td>
                <Td align="right" numero>
                  {formatoMoneda.format(declaradoTotal)}
                </Td>
                <Td align="right" numero>
                  {cerradas.length === 0 ? "—" : formatoMoneda.format(diferenciaTotal)}
                </Td>
                <Td align="right" numero>
                  {ticketsCajas}
                </Td>
              </Tr>
            </tbody>
          </Tabla>
          {abiertas > 0 && (
            <p className="border-t border-border px-[14px] py-[9px] text-[11.5px] text-text-3">
              {abiertas === 1 ? "Hay 1 caja todavía abierta" : `Hay ${abiertas} cajas todavía abiertas`}
              : no tiene{abiertas === 1 ? "" : "n"} contado ni diferencia, y los totales de efectivo
              la dejan afuera hasta que se cierre.
            </p>
          )}
          {devueltoEfectivo > 0 && (
            <p className="border-t border-border px-[14px] py-[9px] text-[11.5px] text-text-3">
              El efectivo esperado ya tiene descontados {formatoMoneda.format(devueltoEfectivo)} de
              devoluciones pagadas del cajón.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
