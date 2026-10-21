import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase/traer-todo";
import { fechaOperativa, inicioDeSemana, inicioDelDia, inicioDelMes } from "@/lib/fecha";
import { formatoFecha, formatoFechaHora, formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { BarRow, Card, EmptyState, Kpi, KpiGrid, SectionHeader } from "../../_components/dashboard/ui";
import { ReporteHeader } from "../_components/reporte-header";
import { Tabla, Td, Th, Tr } from "../_components/tabla";
import { desdePeriodo, leerPeriodo } from "../_lib/periodo";
import { exigirDueno } from "../_lib/permiso";
import { CajaDia } from "./_components/caja-dia";
import { SelectorDia } from "./_components/selector-dia";
import { fechaDelDia, leerDia } from "./_lib/dia";

// Reporte de caja y dinero: todo lo que entró y salió, de las dos
// sucursales (reorganización pedida por el usuario 2026-10-19 -- antes
// estos datos estaban desparramados entre el inicio del dueño y
// /reportes/particulares).
//
// Contesta, en este orden: cuánto se vendió, con qué pagaron, qué pasó con
// cada caja día por día (quién la abrió, quién la cerró, cuánto faltó),
// qué salió del cajón y por qué, qué se devolvió, y qué se cobró sin estar
// en el catálogo.
//
// Criterio de toda la plata que se muestra acá: lo cobrado por medio de
// pago sale de `venta_pagos`, no de `ventas.medio_pago` -- una venta
// "mixta" tiene una parte real en efectivo (ver
// 20260919100000_venta_pagos.sql).

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  qr: "QR",
};

const RESOLUCION_LABEL: Record<string, string> = {
  dinero: "Devolución de dinero",
  cambio: "Cambio por otro producto",
};

type VentaFila = {
  id: string;
  sucursal_id: string;
  fecha: string;
  total: number;
  es_envio: boolean;
};

type CajaFila = {
  id: string;
  fecha: string;
  sucursal_id: string;
  estado: "abierta" | "cerrada";
  monto_apertura: number | null;
  efectivo_sistema: number | null;
  efectivo_declarado: number | null;
  diferencia: number | null;
  cantidad_tickets: number | null;
  empleado_apertura: { nombre: string } | { nombre: string }[] | null;
  empleado_cierre: { nombre: string } | { nombre: string }[] | null;
};

type DevolucionFila = {
  id: string;
  fecha: string;
  sucursal_id: string;
  resolucion: string;
  // Con qué se le devolvió la plata. null en un cambio por otro producto.
  medio_reembolso: string | null;
  monto_reembolsado: number | null;
  venta_id: string;
  usuario: { nombre: string }[] | { nombre: string } | null;
};

type ParticularFila = {
  id: string;
  descripcion: string | null;
  cantidad: number;
  precio_unitario: number;
  venta: {
    fecha: string;
    estado: string;
    sucursal_id: string;
    usuario: { nombre: string } | null;
  } | null;
};

type MovimientoCajaFila = {
  caja_id: string;
  tipo: string;
  monto: number;
  motivo: string;
  creado_en: string;
  // Supabase tipa la relación anidada como array; se normaliza con
  // nombreRel() igual que los empleados de la caja.
  usuario: { nombre: string }[] | { nombre: string } | null;
};

// Supabase devuelve una relación anidada como objeto o como array según el
// caso; se normaliza acá para no ensuciar el JSX (mismo criterio que
// /vender/caja).
function nombreRel(rel: { nombre: string } | { nombre: string }[] | null): string | null {
  const fila = Array.isArray(rel) ? rel[0] : rel;
  return fila?.nombre ?? null;
}

export default async function ReporteCajaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; dia?: string }>;
}) {
  const { periodo: periodoParam, dia: diaParam } = await searchParams;
  const supabase = await createClient();
  await exigirDueno(supabase);

  const hoy = fechaOperativa();
  const dia = leerDia(diaParam);

  // Un día puntual reemplaza al reporte por período: es otra pregunta
  // ("qué pasó el martes") y mezclarla con el rango dejaba dos totales
  // distintos en la misma pantalla (decisión del usuario 2026-10-21).
  if (dia) {
    const { data: sucursalesDia } = await traerTodo(
      supabase
        .from("sucursales")
        .select("id, nombre")
        .eq("activo", true)
        .order("es_central", { ascending: false }),
    );

    return (
      <div className="flex flex-col gap-6">
        <ReporteHeader
          titulo="Caja y dinero"
          bajada="La caja de un día: el arqueo de cada sucursal, con qué pagaron, las ventas una por una y todo lo que se vendió."
          base="/reportes/caja"
          periodo={null}
          extra={<SelectorDia base="/reportes/caja" dia={dia} hoy={hoy} />}
          meta={`${formatoFecha.format(fechaDelDia(dia))}${dia === hoy ? " · hoy" : ""}`}
        />
        <CajaDia supabase={supabase} dia={dia} sucursales={sucursalesDia ?? []} />
      </div>
    );
  }

  const periodo = leerPeriodo(periodoParam);
  const desde = desdePeriodo(periodo);
  const inicioHoy = inicioDelDia();
  const inicioSemana = inicioDeSemana();
  const inicioMes = inicioDelMes();

  // La tabla por sucursal muestra siempre hoy / esta semana / este mes
  // (pedido del usuario: "los datos de las ventas del día, del mes, de los
  // dos locales"), así que se trae desde el corte más viejo entre el
  // período elegido y el mes en curso, y los baldes se arman en JS sobre
  // esas mismas filas: una consulta en vez de cuatro.
  const desdeDatos = new Date(Math.min(desde.getTime(), inicioSemana.getTime(), inicioMes.getTime()));

  const [
    { data: sucursales },
    { data: ventasRaw },
    { data: cajasRaw },
    { data: devolucionesRaw },
    { data: particularesRaw },
  ] = await Promise.all([
    traerTodo(
      supabase
        .from("sucursales")
        .select("id, nombre")
        .eq("activo", true)
        .order("es_central", { ascending: false }),
    ),
    traerTodo(
      supabase
        .from("ventas")
        .select("id, sucursal_id, fecha, total, es_envio")
        .eq("estado", "confirmada")
        .gte("fecha", desdeDatos.toISOString()),
    ),
    traerTodo(
      supabase
        .from("cajas")
        .select(
          `id, fecha, sucursal_id, estado, monto_apertura, efectivo_sistema, efectivo_declarado,
           diferencia, cantidad_tickets,
           empleado_apertura:empleados!cajas_empleado_apertura_id_fkey ( nombre ),
           empleado_cierre:empleados!cajas_empleado_cierre_id_fkey ( nombre )`,
        )
        .gte("fecha", fechaOperativa(desde))
        .order("fecha", { ascending: false }),
    ),
    traerTodo(
      supabase
        .from("devoluciones")
        .select(
          "id, fecha, sucursal_id, resolucion, medio_reembolso, monto_reembolsado, venta_id, usuario:usuarios ( nombre )",
        )
        .gte("fecha", desde.toISOString())
        .order("fecha", { ascending: false }),
    ),
    // Los particulares no se pueden filtrar por fecha en la consulta: la
    // fecha vive en la venta, no en la línea, y un gte() sobre la relación
    // anidada no filtra la tabla de arriba. Se recorta en JS.
    traerTodo(
      supabase
        .from("venta_items")
        .select(
          `id, descripcion, cantidad, precio_unitario,
           venta:ventas ( fecha, estado, sucursal_id, usuario:usuarios ( nombre ) )`,
        )
        .is("sku_id", null),
    ),
  ]);

  const sucursalesList = (sucursales ?? []) as { id: string; nombre: string }[];
  const nombreSucursal = (id: string) => sucursalesList.find((s) => s.id === id)?.nombre ?? "—";

  const ventas = (ventasRaw ?? []) as unknown as VentaFila[];
  const cajas = (cajasRaw ?? []) as unknown as CajaFila[];
  const devoluciones = (devolucionesRaw ?? []) as unknown as DevolucionFila[];

  const desdeIso = desde.toISOString();
  const ventasPeriodo = ventas.filter((v) => v.fecha >= desdeIso);

  // Medios de pago del período: una sola consulta por lotes sobre las
  // ventas que entraron en el rango.
  const idsPeriodo = ventasPeriodo.map((v) => v.id);
  const { data: pagosRaw } = idsPeriodo.length
    ? await traerTodoPorLotes<{ venta_id: string; medio_pago: string; monto: number }>(
        idsPeriodo,
        (lote) =>
          supabase.from("venta_pagos").select("venta_id, medio_pago, monto").in("venta_id", lote),
      )
    : { data: [] };

  // Entradas y salidas del cajón, con el motivo que escribió la encargada:
  // es el detalle que el arqueo necesita para explicar una diferencia.
  const idsCajas = cajas.map((c) => c.id);
  const { data: movimientosRaw } = idsCajas.length
    ? await traerTodoPorLotes<MovimientoCajaFila>(idsCajas, (lote) =>
        supabase
          .from("movimientos_caja")
          .select("caja_id, tipo, monto, motivo, creado_en, usuario:usuarios ( nombre )")
          .in("caja_id", lote),
      )
    : { data: [] };

  const totalDe = (filas: { total: number }[]) => filas.reduce((acc, v) => acc + Number(v.total), 0);

  const inicioHoyIso = inicioHoy.toISOString();
  const inicioSemanaIso = inicioSemana.toISOString();
  const inicioMesIso = inicioMes.toISOString();

  const porSucursal = sucursalesList.map((s) => {
    const suyas = ventas.filter((v) => v.sucursal_id === s.id);
    const delPeriodo = suyas.filter((v) => v.fecha >= desdeIso);
    const totalPeriodo = totalDe(delPeriodo);
    return {
      id: s.id,
      nombre: s.nombre,
      hoy: totalDe(suyas.filter((v) => v.fecha >= inicioHoyIso)),
      semana: totalDe(suyas.filter((v) => v.fecha >= inicioSemanaIso)),
      mes: totalDe(suyas.filter((v) => v.fecha >= inicioMesIso)),
      tickets: delPeriodo.length,
      ticketPromedio: delPeriodo.length > 0 ? totalPeriodo / delPeriodo.length : 0,
    };
  });

  const vendidoPeriodo = totalDe(ventasPeriodo);
  const ticketsPeriodo = ventasPeriodo.length;
  const ticketPromedio = ticketsPeriodo > 0 ? vendidoPeriodo / ticketsPeriodo : 0;

  const enviosPeriodo = ventasPeriodo.filter((v) => v.es_envio);
  const enviosTotal = totalDe(enviosPeriodo);

  const porMedio = new Map<string, number>();
  let cobradoPorMedio = 0;
  for (const p of pagosRaw ?? []) {
    porMedio.set(p.medio_pago, (porMedio.get(p.medio_pago) ?? 0) + Number(p.monto));
    cobradoPorMedio += Number(p.monto);
  }
  const mediosOrdenados = [...porMedio.entries()].sort((a, b) => b[1] - a[1]);
  const maxMedio = mediosOrdenados[0]?.[1] ?? 0;

  const devolucionesDinero = devoluciones.filter((d) => d.resolucion === "dinero");
  const devolucionesMonto = devolucionesDinero.reduce(
    (acc, d) => acc + Number(d.monto_reembolsado ?? 0),
    0,
  );
  // Lo que realmente salió del cajón: una devolución por posnet le vuelve
  // a la tarjeta del cliente y no toca el efectivo (ver
  // 20261019110000_devolucion_medio_reembolso.sql).
  const devolucionesEfectivo = devolucionesDinero
    .filter((d) => d.medio_reembolso === "efectivo")
    .reduce((acc, d) => acc + Number(d.monto_reembolsado ?? 0), 0);

  const movimientos = [...(movimientosRaw ?? [])].sort((a, b) =>
    a.creado_en < b.creado_en ? 1 : -1,
  );
  const cajaPorId = new Map(cajas.map((c) => [c.id, c]));
  const salidasTotal = movimientos
    .filter((m) => m.tipo === "salida")
    .reduce((acc, m) => acc + Number(m.monto), 0);
  const entradasTotal = movimientos
    .filter((m) => m.tipo === "entrada")
    .reduce((acc, m) => acc + Number(m.monto), 0);

  const particulares = ((particularesRaw ?? []) as unknown as ParticularFila[])
    .filter((p) => p.venta?.estado === "confirmada" && p.venta.fecha >= desdeIso)
    .sort((a, b) => (b.venta?.fecha ?? "").localeCompare(a.venta?.fecha ?? ""));
  const particularesTotal = particulares.reduce(
    (acc, p) => acc + Number(p.precio_unitario) * p.cantidad,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <ReporteHeader
        titulo="Caja y dinero"
        bajada="Lo que entró y salió en las dos sucursales: ventas, medios de pago, cierres de caja, egresos, devoluciones y productos particulares."
        base="/reportes/caja"
        periodo={periodo}
        extra={<SelectorDia base="/reportes/caja" dia={null} hoy={hoy} />}
      />

      <KpiGrid>
        <Kpi
          label="Vendido"
          value={formatoMoneda.format(vendidoPeriodo)}
          sub={`${ticketsPeriodo} ticket${ticketsPeriodo === 1 ? "" : "s"}`}
        />
        <Kpi label="Ticket promedio" value={formatoMoneda.format(ticketPromedio)} />
        <Kpi
          label="Devoluciones de dinero"
          value={formatoMoneda.format(devolucionesMonto)}
          sub={`${formatoMoneda.format(devolucionesEfectivo)} salieron del cajón · ${devoluciones.length} devolución${devoluciones.length === 1 ? "" : "es"} en total`}
        />
        <Kpi
          label="Salidas de caja"
          value={formatoMoneda.format(salidasTotal)}
          sub={
            entradasTotal > 0 ? `${formatoMoneda.format(entradasTotal)} de entradas` : "Sin entradas"
          }
        />
      </KpiGrid>

      <div>
        <SectionHeader
          title="Ventas por sucursal"
          meta="Hoy, semana y mes son fijos; tickets y promedio siguen el período elegido"
        />
        <Card title="Vendido">
          <Tabla>
            <thead>
              <tr>
                <Th>Sucursal</Th>
                <Th align="right">Hoy</Th>
                <Th align="right">Esta semana</Th>
                <Th align="right">Este mes</Th>
                <Th align="right">Tickets</Th>
                <Th align="right">Ticket promedio</Th>
              </tr>
            </thead>
            <tbody>
              {porSucursal.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <span className="font-medium text-text">{s.nombre}</span>
                  </Td>
                  <Td align="right" numero>
                    {formatoMoneda.format(s.hoy)}
                  </Td>
                  <Td align="right" numero>
                    {formatoMoneda.format(s.semana)}
                  </Td>
                  <Td align="right" numero>
                    {formatoMoneda.format(s.mes)}
                  </Td>
                  <Td align="right" numero>
                    {s.tickets}
                  </Td>
                  <Td align="right" numero>
                    {formatoMoneda.format(s.ticketPromedio)}
                  </Td>
                </Tr>
              ))}
              <Tr total>
                <Td>Total</Td>
                <Td align="right" numero>
                  {formatoMoneda.format(porSucursal.reduce((a, s) => a + s.hoy, 0))}
                </Td>
                <Td align="right" numero>
                  {formatoMoneda.format(porSucursal.reduce((a, s) => a + s.semana, 0))}
                </Td>
                <Td align="right" numero>
                  {formatoMoneda.format(porSucursal.reduce((a, s) => a + s.mes, 0))}
                </Td>
                <Td align="right" numero>
                  {ticketsPeriodo}
                </Td>
                <Td align="right" numero>
                  {formatoMoneda.format(ticketPromedio)}
                </Td>
              </Tr>
            </tbody>
          </Tabla>
        </Card>
      </div>

      <div>
        <SectionHeader title="Con qué pagaron" meta="Las promociones aplican solo en efectivo" />
        <Card title={`Medios de pago · ${formatoMoneda.format(cobradoPorMedio)}`}>
          {mediosOrdenados.length === 0 ? (
            <EmptyState
              title="Sin cobros en el período"
              sub="Todavía no hay ventas confirmadas en este rango."
            />
          ) : (
            <div className="flex flex-col gap-[9px] px-[14px] py-[13px]">
              {mediosOrdenados.map(([medio, monto]) => (
                <BarRow
                  key={medio}
                  label={MEDIO_LABEL[medio] ?? medio}
                  value={monto}
                  max={maxMedio}
                  display={formatoMoneda.format(monto)}
                />
              ))}
              {enviosPeriodo.length > 0 && (
                <p className="mt-[4px] text-[11.5px] text-text-3">
                  De ese total, {enviosPeriodo.length} envío{enviosPeriodo.length === 1 ? "" : "s"}{" "}
                  por {formatoMoneda.format(enviosTotal)} — ya contados en su medio de pago, no son
                  una caja aparte.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Cajas día por día"
          meta="Tocá una fecha para ver ese día completo: ventas y productos"
        />
        <Card title={`${cajas.length} caja${cajas.length === 1 ? "" : "s"} en el período`}>
          {cajas.length === 0 ? (
            <EmptyState
              title="Sin cajas en el período"
              sub="No se abrió ninguna caja en este rango de fechas."
            />
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Sucursal</Th>
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
                        href={`/reportes/caja?dia=${c.fecha}`}
                        className="font-medium text-moe hover:underline"
                      >
                        {formatoFecha.format(new Date(`${c.fecha}T12:00:00`))}
                      </Link>
                    </Td>
                    <Td>{nombreSucursal(c.sucursal_id)}</Td>
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
                      {c.efectivo_declarado == null
                        ? "—"
                        : formatoMoneda.format(c.efectivo_declarado)}
                    </Td>
                    <Td align="right" numero>
                      {c.diferencia == null ? (
                        <span className="text-text-3">—</span>
                      ) : (
                        <span
                          className={
                            c.diferencia === 0
                              ? "text-ok"
                              : c.diferencia < 0
                                ? "text-err"
                                : "text-warn"
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
              </tbody>
            </Tabla>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Entradas y salidas del cajón"
          meta="Con el motivo que escribió quien lo hizo"
        />
        <Card
          title={`Salidas ${formatoMoneda.format(salidasTotal)} · entradas ${formatoMoneda.format(entradasTotal)}`}
        >
          {movimientos.length === 0 ? (
            <EmptyState
              title="Sin movimientos de caja"
              sub="No se sacó ni se agregó plata al cajón fuera de las ventas."
            />
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Sucursal</Th>
                  <Th>Tipo</Th>
                  <Th>Motivo</Th>
                  <Th>Quién</Th>
                  <Th align="right">Monto</Th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m, i) => {
                  const caja = cajaPorId.get(m.caja_id);
                  return (
                    <Tr key={`${m.caja_id}:${m.creado_en}:${i}`}>
                      <Td>{formatoFechaHora.format(new Date(m.creado_en))}</Td>
                      <Td>{caja ? nombreSucursal(caja.sucursal_id) : "—"}</Td>
                      <Td>
                        {m.tipo === "entrada" ? (
                          <span className="rounded-[5px] bg-ok-bg px-[7px] py-[2px] text-[11px] font-medium text-ok">
                            Entrada
                          </span>
                        ) : (
                          <span className="rounded-[5px] bg-err-bg px-[7px] py-[2px] text-[11px] font-medium text-err">
                            Salida
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-text">{m.motivo}</span>
                      </Td>
                      <Td>{nombreRel(m.usuario) ?? "—"}</Td>
                      <Td align="right" numero>
                        <span className={m.tipo === "entrada" ? "text-ok" : "text-err"}>
                          {m.tipo === "entrada" ? "+" : "−"}
                          {formatoMoneda.format(Number(m.monto))}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Tabla>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Devoluciones"
          meta="Solo la devuelta en efectivo descuenta del arqueo del día"
        />
        <Card title={`${devoluciones.length} devolución${devoluciones.length === 1 ? "" : "es"}`}>
          {devoluciones.length === 0 ? (
            <EmptyState title="Sin devoluciones" sub="No volvió mercadería en este período." />
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Sucursal</Th>
                  <Th>Resolución</Th>
                  <Th>Se devolvió con</Th>
                  <Th>Quién</Th>
                  <Th align="right">Reembolsado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {devoluciones.map((d) => (
                  <Tr key={d.id}>
                    <Td>{formatoFechaHora.format(new Date(d.fecha))}</Td>
                    <Td>{nombreSucursal(d.sucursal_id)}</Td>
                    <Td>
                      <span className="text-text">
                        {RESOLUCION_LABEL[d.resolucion] ?? d.resolucion}
                      </span>
                    </Td>
                    <Td>
                      {d.medio_reembolso == null ? (
                        <span className="text-text-3">—</span>
                      ) : (
                        <>
                          {MEDIO_LABEL[d.medio_reembolso] ?? d.medio_reembolso}
                          {d.medio_reembolso !== "efectivo" && (
                            <span className="text-text-3"> · no sale del cajón</span>
                          )}
                        </>
                      )}
                    </Td>
                    <Td>{nombreRel(d.usuario) ?? "—"}</Td>
                    <Td align="right" numero mute={d.monto_reembolsado == null}>
                      {d.monto_reembolsado == null
                        ? "sin dinero"
                        : `−${formatoMoneda.format(d.monto_reembolsado)}`}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/ticket/${d.venta_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] font-medium text-moe hover:underline"
                      >
                        Ver venta
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Productos particulares"
          meta="Lo que se cobró sin estar en el catálogo: no tiene SKU ni mueve stock"
        />
        <Card
          title={`${particulares.length} línea${particulares.length === 1 ? "" : "s"} · ${formatoMoneda.format(particularesTotal)}`}
        >
          {particulares.length === 0 ? (
            <EmptyState
              title="Sin productos particulares"
              sub="Todo lo vendido en este período estaba en el catálogo."
            />
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Sucursal</Th>
                  <Th>Descripción</Th>
                  <Th>Quién vendió</Th>
                  <Th align="right">Cantidad</Th>
                  <Th align="right">Importe</Th>
                </tr>
              </thead>
              <tbody>
                {particulares.map((p) => (
                  <Tr key={p.id}>
                    <Td>{p.venta ? formatoFechaHora.format(new Date(p.venta.fecha)) : "—"}</Td>
                    <Td>{p.venta ? nombreSucursal(p.venta.sucursal_id) : "—"}</Td>
                    <Td>
                      <span className="font-medium text-text">
                        {p.descripcion ?? "Sin descripción"}
                      </span>
                    </Td>
                    <Td>{p.venta?.usuario?.nombre ?? "—"}</Td>
                    <Td align="right" numero>
                      {p.cantidad}
                    </Td>
                    <Td align="right" numero>
                      {formatoMoneda.format(Number(p.precio_unitario) * p.cantidad)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Card>
      </div>
    </div>
  );
}
