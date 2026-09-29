import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { TIPO_COMPROBANTE_LABEL, type TipoComprobante } from "@/app/(app)/compras/_lib/comprobante";
import { BarRow, Card, EmptyState, Kpi, KpiGrid, SectionHeader } from "../../_components/dashboard/ui";

// Una fila por mes, tal como la devuelve reporte_iva_mensual()
// (20260928090000_iva_compras_balance.sql).
type FilaMes = {
  mes: string;
  iva_ventas: number;
  neto_ventas: number;
  total_facturado: number;
  comprobantes_a: number;
  comprobantes_b: number;
  total_vendido: number;
  iva_compras: number;
  neto_compras: number;
  total_compras_con_credito: number;
  total_compras_sin_credito: number;
  total_compras_sin_comprobante: number;
  total_compras_sin_clasificar: number;
  percepciones: number;
  saldo: number;
};

type FilaCompra = {
  compra_id: string;
  fecha_fiscal: string | null;
  proveedor: string;
  tipo_comprobante: TipoComprobante | null;
  numero_factura: string | null;
  neto_gravado: number | null;
  iva: number | null;
  percepciones: number | null;
  total: number;
};

const MESES_HISTORIAL = 12;

// Las fechas vienen como "AAAA-MM-DD". new Date("2026-09-01") es medianoche
// UTC, que en Argentina (UTC-3) cae el 31 de agosto: el mes se mostraría
// corrido. Por eso se arma la fecha a mano, en hora local.
function mesDesdeIso(iso: string): Date {
  const [anio, mes] = iso.split("-").map(Number);
  return new Date(anio, mes - 1, 1);
}

function fechaDesdeIso(iso: string): Date {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

function isoDeMes(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-01`;
}

function sumarMeses(fecha: Date, meses: number): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth() + meses, 1);
}

const formatoMes = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });
const formatoMesCorto = new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit" });
const formatoDia = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function porcentaje(parte: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((parte / total) * 100)}%`;
}

const COMPROBANTE_TONO: Record<TipoComprobante | "sin_clasificar", string> = {
  factura_a: "text-ok",
  factura_b: "text-info",
  remito: "text-warn",
  sin_clasificar: "text-text-3",
};

export default async function BalanceIvaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesParam } = await searchParams;
  const supabase = await createClient();

  const hoy = new Date();
  const mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const mesElegido =
    mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesDesdeIso(`${mesParam}-01`) : mesActual;

  const desde = sumarMeses(mesElegido, -(MESES_HISTORIAL - 1));

  const [{ data: filas, error }, { data: comprasMes }] = await Promise.all([
    supabase.rpc("reporte_iva_mensual", {
      p_desde: isoDeMes(desde),
      p_hasta: isoDeMes(mesElegido),
    }),
    supabase.rpc("reporte_iva_compras_mes", { p_mes: isoDeMes(mesElegido) }),
  ]);

  if (error) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No pudimos calcular el balance: {error.message}
      </div>
    );
  }

  const meses = (filas ?? []) as FilaMes[];
  const compras = (comprasMes ?? []) as FilaCompra[];
  const mesIso = isoDeMes(mesElegido);
  const actual =
    meses.find((m) => m.mes === mesIso) ??
    ({
      mes: mesIso,
      iva_ventas: 0,
      neto_ventas: 0,
      total_facturado: 0,
      comprobantes_a: 0,
      comprobantes_b: 0,
      total_vendido: 0,
      iva_compras: 0,
      neto_compras: 0,
      total_compras_con_credito: 0,
      total_compras_sin_credito: 0,
      total_compras_sin_comprobante: 0,
      total_compras_sin_clasificar: 0,
      percepciones: 0,
      saldo: 0,
    } satisfies FilaMes);

  const aPagar = actual.saldo >= 0;
  const totalCompras =
    actual.total_compras_con_credito +
    actual.total_compras_sin_credito +
    actual.total_compras_sin_comprobante +
    actual.total_compras_sin_clasificar;
  const ventasSinFacturar = Math.max(0, actual.total_vendido - actual.total_facturado);
  const maxCompras = Math.max(totalCompras, 1);
  const maxVentas = Math.max(actual.total_vendido, 1);

  const mesAnterior = sumarMeses(mesElegido, -1);
  const mesSiguiente = sumarMeses(mesElegido, 1);
  const hayMesSiguiente = mesSiguiente <= mesActual;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-text">Balance de IVA</h1>
          <p className="mt-[2px] text-[12.5px] text-text-3">
            Lo que cobrás de IVA en lo que facturás contra lo que pagás de IVA en las compras con
            factura.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/reportes/iva?mes=${isoDeMes(mesAnterior).slice(0, 7)}`}
            className="rounded-[6px] border border-border px-[9px] py-[5px] text-[13px] text-text-2 hover:bg-bg-2"
            aria-label="Mes anterior"
          >
            ←
          </Link>
          <span className="min-w-[150px] text-center text-[13.5px] font-medium text-text">
            {capitalizar(formatoMes.format(mesElegido))}
          </span>
          {hayMesSiguiente ? (
            <Link
              href={`/reportes/iva?mes=${isoDeMes(mesSiguiente).slice(0, 7)}`}
              className="rounded-[6px] border border-border px-[9px] py-[5px] text-[13px] text-text-2 hover:bg-bg-2"
              aria-label="Mes siguiente"
            >
              →
            </Link>
          ) : (
            <span className="rounded-[6px] border border-border px-[9px] py-[5px] text-[13px] text-text-3">
              →
            </span>
          )}
        </div>
      </div>

      <KpiGrid>
        <Kpi
          label="IVA de tus ventas"
          value={formatoMoneda.format(actual.iva_ventas)}
          sub={`${actual.comprobantes_a + actual.comprobantes_b} comprobantes emitidos`}
        />
        <Kpi
          label="IVA de tus compras"
          value={formatoMoneda.format(actual.iva_compras)}
          sub="Solo compras con Factura A"
        />
        <Kpi
          label={aPagar ? "Te queda a pagar" : "Te queda a favor"}
          value={
            <span className={aPagar ? "text-orange" : "text-ok"}>
              {formatoMoneda.format(Math.abs(actual.saldo))}
            </span>
          }
          sub={aPagar ? "Diferencia del mes" : "Se descuenta el mes que viene"}
        />
        <Kpi
          label="Percepciones sufridas"
          value={formatoMoneda.format(actual.percepciones)}
          sub="Pago a cuenta, aparte del saldo"
        />
      </KpiGrid>

      <div className="rounded-card border border-border bg-bg px-[15px] py-[13px] text-[13.5px] leading-[1.55] text-text-2">
        En {formatoMes.format(mesElegido)} cobraste{" "}
        <b className="font-medium tabular-nums text-text">{formatoMoneda.format(actual.iva_ventas)}</b>{" "}
        de IVA en lo que facturaste y pagaste{" "}
        <b className="font-medium tabular-nums text-text">{formatoMoneda.format(actual.iva_compras)}</b>{" "}
        de IVA en compras con factura.{" "}
        {aPagar ? (
          <>
            Te queda{" "}
            <b className="font-medium tabular-nums text-text">
              {formatoMoneda.format(actual.saldo)}
            </b>{" "}
            para pagar.
          </>
        ) : (
          <>
            Te queda{" "}
            <b className="font-medium tabular-nums text-text">
              {formatoMoneda.format(Math.abs(actual.saldo))}
            </b>{" "}
            a favor para descontar el mes que viene.
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Compras del mes">
          {totalCompras === 0 ? (
            <EmptyState
              title="No hay compras en este mes"
              sub="Cuando la encargada cargue mercadería, acá vas a ver cuánto entró con factura y cuánto sin."
            />
          ) : (
            <div className="flex flex-col gap-[9px] px-[14px] py-[13px]">
              <BarRow
                label="Con Factura A"
                value={actual.total_compras_con_credito}
                max={maxCompras}
                display={`${formatoMoneda.format(actual.total_compras_con_credito)} · ${porcentaje(
                  actual.total_compras_con_credito,
                  totalCompras,
                )}`}
              />
              <BarRow
                label="Con Factura B"
                value={actual.total_compras_sin_credito}
                max={maxCompras}
                display={`${formatoMoneda.format(actual.total_compras_sin_credito)} · ${porcentaje(
                  actual.total_compras_sin_credito,
                  totalCompras,
                )}`}
              />
              <BarRow
                label="Con remito"
                value={actual.total_compras_sin_comprobante}
                max={maxCompras}
                display={`${formatoMoneda.format(actual.total_compras_sin_comprobante)} · ${porcentaje(
                  actual.total_compras_sin_comprobante,
                  totalCompras,
                )}`}
                tone="loss"
              />
              {actual.total_compras_sin_clasificar > 0 && (
                <BarRow
                  label="Sin clasificar"
                  value={actual.total_compras_sin_clasificar}
                  max={maxCompras}
                  display={formatoMoneda.format(actual.total_compras_sin_clasificar)}
                />
              )}
              <p className="mt-[3px] border-t border-border pt-[8px] text-[12.5px] text-text-2">
                Total comprado:{" "}
                <b className="font-medium tabular-nums text-text">
                  {formatoMoneda.format(totalCompras)}
                </b>
                . Solo la Factura A descuenta IVA.
              </p>
            </div>
          )}
        </Card>

        <Card title="Ventas del mes">
          {actual.total_vendido === 0 ? (
            <EmptyState
              title="No hay ventas en este mes"
              sub="El IVA de ventas sale de los comprobantes que emitís desde el punto de venta."
            />
          ) : (
            <div className="flex flex-col gap-[9px] px-[14px] py-[13px]">
              <BarRow
                label="Facturado"
                value={actual.total_facturado}
                max={maxVentas}
                display={`${formatoMoneda.format(actual.total_facturado)} · ${porcentaje(
                  actual.total_facturado,
                  actual.total_vendido,
                )}`}
              />
              <BarRow
                label="Sin facturar"
                value={ventasSinFacturar}
                max={maxVentas}
                display={`${formatoMoneda.format(ventasSinFacturar)} · ${porcentaje(
                  ventasSinFacturar,
                  actual.total_vendido,
                )}`}
                tone="loss"
              />
              <p className="mt-[3px] border-t border-border pt-[8px] text-[12.5px] text-text-2">
                Total vendido:{" "}
                <b className="font-medium tabular-nums text-text">
                  {formatoMoneda.format(actual.total_vendido)}
                </b>
                . {actual.comprobantes_a} factura{actual.comprobantes_a === 1 ? "" : "s"} A y{" "}
                {actual.comprobantes_b} B. No incluye depósitos de envase.
              </p>
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader title="Compras del mes, una por una" />
        <div className="overflow-hidden rounded-card border border-border bg-bg">
          {compras.length === 0 ? (
            <EmptyState
              title="Todavía no hay compras en este mes"
              sub="Las compras aparecen con la fecha de su factura; las que llegaron con remito, con la fecha en que entró la mercadería."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Fecha
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Proveedor
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Comprobante
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Neto
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      IVA
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {compras.map((c) => (
                    <tr
                      key={c.compra_id}
                      className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]"
                    >
                      <td className="px-0 py-0">
                        <Link
                          href={`/compras/${c.compra_id}`}
                          className="block px-[14px] py-[9px] tabular-nums text-text-2"
                        >
                          {c.fecha_fiscal ? formatoDia.format(fechaDesdeIso(c.fecha_fiscal)) : "—"}
                        </Link>
                      </td>
                      <td className="px-[14px] py-[9px] align-middle font-medium text-text">
                        {c.proveedor}
                      </td>
                      <td className="px-[14px] py-[9px] align-middle">
                        <span
                          className={`text-[12.5px] font-medium ${
                            COMPROBANTE_TONO[c.tipo_comprobante ?? "sin_clasificar"]
                          }`}
                        >
                          {c.tipo_comprobante
                            ? TIPO_COMPROBANTE_LABEL[c.tipo_comprobante]
                            : "Sin clasificar"}
                        </span>
                        {c.numero_factura && (
                          <span className="ml-[6px] text-[12px] text-text-3">{c.numero_factura}</span>
                        )}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {c.neto_gravado === null ? "—" : formatoMoneda.format(c.neto_gravado)}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {c.iva === null ? "—" : formatoMoneda.format(c.iva)}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
                        {formatoMoneda.format(c.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div>
        <SectionHeader title="Últimos 12 meses" meta="Tocá un mes para verlo en detalle" />
        <div className="overflow-hidden rounded-card border border-border bg-bg">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Mes
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    IVA ventas
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    IVA compras
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {meses.map((m) => {
                  const fecha = mesDesdeIso(m.mes);
                  const esActual = m.mes === mesIso;
                  return (
                    <tr
                      key={m.mes}
                      className={`border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB] ${
                        esActual ? "bg-bg-2" : ""
                      }`}
                    >
                      <td className="px-0 py-0">
                        <Link
                          href={`/reportes/iva?mes=${m.mes.slice(0, 7)}`}
                          className="block px-[14px] py-[9px] font-medium text-text"
                        >
                          {capitalizar(formatoMesCorto.format(fecha))}
                        </Link>
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {formatoMoneda.format(m.iva_ventas)}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {formatoMoneda.format(m.iva_compras)}
                      </td>
                      <td
                        className={`px-[14px] py-[9px] text-right align-middle font-medium tabular-nums ${
                          m.saldo >= 0 ? "text-orange" : "text-ok"
                        }`}
                      >
                        {m.saldo >= 0
                          ? formatoMoneda.format(m.saldo)
                          : `${formatoMoneda.format(Math.abs(m.saldo))} a favor`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-[12px] leading-[1.55] text-text-3">
        Este balance es para que veas cómo viene el mes, no es la declaración de IVA. No incluye los
        gastos que no son mercadería (luz, alquiler, fletes, servicios), que también descuentan IVA,
        ni las notas de crédito por devoluciones. El número final lo define tu contador.
      </p>
    </div>
  );
}
