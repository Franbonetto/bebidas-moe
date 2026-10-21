"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { formatoFechaHora, formatoMoneda, formatoMonedaExacto } from "../_lib/formato";
import {
  TIPOS_COMPROBANTE,
  TIPO_COMPROBANTE_AYUDA,
  TIPO_COMPROBANTE_LABEL,
  desglosarIvaCompra,
  redondearPeso,
  tieneDesglose,
  tienePieFiscal,
  totalPagadoCompra,
  type TipoComprobante,
} from "../_lib/comprobante";
import { reclasificarComprobanteCompra } from "../actions";
import { ComprobanteBadge, EstadoCompraBadge, type Compra } from "./compras-table";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";

type SkuInfo = SkuPresentacion & {
  nombre: string;
  codigo_interno: string;
  producto: {
    nombre: string;
    marca: { nombre: string } | null;
    categoria?: { alicuota_iva: number } | null;
  } | null;
};

export type ItemCompraDetalle = {
  id: string;
  sku_id: string;
  cantidad: number;
  costo_unitario: number;
  // Lo que salio de verdad cada unidad, con los impuestos del pie
  // repartidos. Lo calcula la base al cargar la compra
  // (20261016090000_costo_con_impuestos.sql) y es el costo que el sistema
  // usa para el margen. null = compra sin pie (remito) o anterior a esa
  // migracion.
  costo_con_impuestos: number | null;
  subtotal: number;
  fecha_vencimiento: string | null;
  recibido_previo: number;
  pendiente: number;
  sku: SkuInfo | null;
};

export type RecepcionDetalle = {
  id: string;
  fecha: string;
  estado: "pendiente" | "recibida";
  usuario: { nombre: string } | null;
  recepcion_items: {
    compra_item_id: string;
    cantidad_recibida: number;
    diferencia: number | null;
    motivo_diferencia: string | null;
  }[];
};

export type CompraDetalleData = Compra & {
  items: ItemCompraDetalle[];
};

// Log inmutable de cambios del comprobante fiscal (el caso típico: llegó con
// remito y la factura apareció tres días después).
export type ReclasificacionCompra = {
  id: string;
  tipo_anterior: TipoComprobante | null;
  tipo_nuevo: TipoComprobante;
  numero_nuevo: string | null;
  fecha_nueva: string | null;
  iva_nuevo: number | null;
  flete_anterior: number | null;
  flete_nuevo: number | null;
  motivo: string;
  fecha: string;
  usuario: { nombre: string } | null;
};

function nombreSku(sku: SkuInfo | null) {
  if (!sku) return "SKU eliminado";
  return sku.producto?.nombre ?? sku.nombre;
}

function presentacionSku(sku: SkuInfo | null) {
  if (!sku) return "";
  return [sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ");
}

function formatoVencimiento(fecha: string | null) {
  if (!fecha) return "—";
  const [aaaa, mm, dd] = fecha.split("-");
  return `${dd}/${mm}/${aaaa}`;
}

// Una fila del desglose: concepto a la izquierda, monto a la derecha,
// leído igual que el cuadro de abajo de la factura.
function FilaDesglose({
  label,
  ayuda,
  monto,
  apagado,
  fuerte,
}: {
  label: string;
  ayuda?: string;
  monto: number;
  apagado?: boolean;
  fuerte?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[2px]">
      <span className={`text-[12.5px] ${fuerte ? "font-medium text-text" : "text-text-2"}`}>
        {label}
        {ayuda && <span className="mt-[1px] block text-[11px] leading-[1.3] text-text-3">{ayuda}</span>}
      </span>
      <span
        className={`whitespace-nowrap tabular-nums ${
          fuerte
            ? "text-[13.5px] font-semibold text-text"
            : apagado
              ? "text-[12.5px] text-text-3"
              : "text-[12.5px] text-text"
        }`}
      >
        {formatoMonedaExacto.format(monto)}
      </span>
    </div>
  );
}

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

// Cargar (o corregir) el comprobante fiscal de una compra ya cerrada. No
// toca stock, costos ni el total: solo cambia con qué vino esa mercadería, y
// exige motivo -- queda una fila en compras_reclasificacion_fiscal.
function ComprobanteForm({
  compra,
  netoSugerido,
  ivaSugerido,
  onListo,
  onCancelar,
}: {
  compra: CompraDetalleData;
  netoSugerido: number;
  ivaSugerido: number;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [tipo, setTipo] = useState<TipoComprobante | "">(compra.tipo_comprobante ?? "");
  const [numero, setNumero] = useState(compra.numero_factura ?? "");
  const [fecha, setFecha] = useState(compra.fecha_factura ?? "");
  const [neto, setNeto] = useState<string | null>(
    compra.neto_gravado !== null ? String(compra.neto_gravado) : null,
  );
  const [iva, setIva] = useState<string | null>(compra.iva !== null ? String(compra.iva) : null);
  const [internos, setInternos] = useState(
    compra.impuestos_internos !== null ? String(compra.impuestos_internos) : "",
  );
  const [percepcionIva, setPercepcionIva] = useState(
    compra.percepcion_iva !== null ? String(compra.percepcion_iva) : "",
  );
  const [percepcionIibb, setPercepcionIibb] = useState(
    compra.percepcion_iibb !== null ? String(compra.percepcion_iibb) : "",
  );
  // El flete se corrige por acá igual que la factura que llegó tarde: no se
  // edita la compra a mano, queda la fila en el log y se recalcula el costo.
  const [flete, setFlete] = useState(compra.flete !== null ? String(compra.flete) : "");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const esFactura = tipo === "factura_a" || tipo === "factura_b";
  const discriminaIva = tipo === "factura_a";
  const netoMostrado = neto ?? redondearPeso(netoSugerido).toFixed(2);
  const ivaMostrado = iva ?? redondearPeso(ivaSugerido).toFixed(2);

  const pedirPin = usePinOperaciones();

  async function guardar() {
    setError(null);

    const pin = await pedirPin();
    if (!pin) return;

    startTransition(async () => {
      const resultado = await reclasificarComprobanteCompra({
        compra_id: compra.id,
        comprobante: {
          tipo_comprobante: tipo as TipoComprobante,
          numero_factura: numero.trim() || null,
          fecha_factura: fecha || null,
          neto_gravado: discriminaIva && netoMostrado !== "" ? Number(netoMostrado) : null,
          iva: discriminaIva && ivaMostrado !== "" ? Number(ivaMostrado) : null,
          impuestos_internos: discriminaIva && internos !== "" ? Number(internos) : null,
          percepcion_iva: discriminaIva && percepcionIva !== "" ? Number(percepcionIva) : null,
          percepcion_iibb: discriminaIva && percepcionIibb !== "" ? Number(percepcionIibb) : null,
        },
        flete: flete === "" ? null : Number(flete),
        motivo,
      }, pin);

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onListo();
    });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TIPOS_COMPROBANTE.map((t) => {
          const activo = tipo === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`rounded-[6px] border px-[10px] py-[7px] text-left ${
                activo
                  ? "border-moe bg-moe-soft text-moe"
                  : "border-border bg-bg text-text-2 hover:bg-[#FAFAFB]"
              }`}
            >
              <span className="block text-[13px] font-medium">{TIPO_COMPROBANTE_LABEL[t]}</span>
              <span className="mt-[1px] block text-[11px] leading-[1.3] text-text-3">
                {TIPO_COMPROBANTE_AYUDA[t]}
              </span>
            </button>
          );
        })}
      </div>

      {esFactura && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Número de factura *</label>
            <input className={inputClass} value={numero} onChange={(e) => setNumero(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Fecha de la factura *</label>
            <input
              type="date"
              className={inputClass}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
        </div>
      )}

      {discriminaIva && (
        <>
          <p className="mt-3 text-[12px] text-text-3">
            El pie de la factura, con los mismos nombres que trae el papel.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Neto gravado *</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} text-right tabular-nums`}
                value={netoMostrado}
                onChange={(e) => setNeto(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Impuestos internos</label>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                className={`${inputClass} text-right tabular-nums`}
                value={internos}
                onChange={(e) => setInternos(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>IVA *</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} text-right tabular-nums`}
                value={ivaMostrado}
                onChange={(e) => setIva(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Percepción IVA</label>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                className={`${inputClass} text-right tabular-nums`}
                value={percepcionIva}
                onChange={(e) => setPercepcionIva(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Percepción IIBB</label>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="0"
                className={`${inputClass} text-right tabular-nums`}
                value={percepcionIibb}
                onChange={(e) => setPercepcionIibb(e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      <div className="mt-3 sm:w-1/3 sm:pr-2">
        <label className={labelClass}>Flete</label>
        <input
          type="number"
          min={0}
          step="0.01"
          placeholder="0"
          className={`${inputClass} text-right tabular-nums`}
          value={flete}
          onChange={(e) => setFlete(e.target.value)}
        />
        <p className="mt-[4px] text-[11px] leading-[1.3] text-text-3">
          Solo si se pagó aparte. Cambiarlo recalcula el costo de estos productos.
        </p>
      </div>

      <div className="mt-3">
        <label className={labelClass}>¿Por qué se corrige? *</label>
        <input
          className={inputClass}
          placeholder="Ej.: llegó la factura del remito del 12/09"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}

      <div className="mt-3 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancelar}
          className="text-[12.5px] text-text-3 hover:text-text"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar comprobante"}
        </button>
      </div>
    </div>
  );
}

// Solo lectura: toda compra se carga y recibe en un solo paso desde
// "Cargar mercadería" (cargar_compra_directa()), así que para cuando esta
// pantalla existe la compra ya está cerrada -- no hay borrador para editar
// ni recepciones parciales para armar a mano (decisión del usuario
// 2026-09-21: "no trabaja así el local", se sacó el flujo de "Nueva
// compra" en varias tandas).
export function CompraDetalle({
  compra,
  recepciones,
  reclasificaciones,
  puedeReclasificar,
}: {
  compra: CompraDetalleData;
  recepciones: RecepcionDetalle[];
  reclasificaciones: ReclasificacionCompra[];
  // El dueño solo visualiza compras: el comprobante lo carga la encargada
  // (20260922140000_compras_solo_lectura_dueno.sql).
  puedeReclasificar: boolean;
}) {
  const itemsPorId = useMemo(() => new Map(compra.items.map((i) => [i.id, i])), [compra.items]);
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [verDesglose, setVerDesglose] = useState(false);

  // Lo que se pagó por la compra: productos, todo lo que suma el pie y el
  // flete que se haya pagado aparte. Es el número grande de la pantalla,
  // el mismo que figura abajo de todo en el papel (usuario 2026-10-16).
  const totalPagado = totalPagadoCompra(compra);
  const hayPie = tienePieFiscal(compra);
  // Un remito con flete no tiene pie, pero sí tiene algo repartido entre
  // las líneas: el desglose también se muestra en ese caso.
  const hayDesglose = tieneDesglose(compra);
  const unidades = useMemo(
    () => compra.items.reduce((acc, it) => acc + it.cantidad, 0),
    [compra.items],
  );

  // Los impuestos del pie y el flete son de toda la entrega, así que para
  // saber cuánto salió de verdad cada cosa se reparten entre las líneas
  // según cuánto pesa cada una: lo pagado dividido lo que suman los
  // productos.
  //
  // Sale bien carguen las líneas en neto (el factor da 1,28: IVA más las
  // dos percepciones) o con IVA adentro (da 1,06: solo las percepciones,
  // porque el IVA ya está en el costo). Nunca duplica.
  const factorImpuestos = hayDesglose && compra.total > 0 ? totalPagado / compra.total : 1;

  // Propuesta de desglose para cuando la factura llega después: el costo
  // cargado es el precio final pagado, el neto sale para atrás.
  const desgloseSugerido = useMemo(
    () =>
      desglosarIvaCompra(
        compra.items.map((it) => ({
          total: it.subtotal,
          alicuotaIva: it.sku?.producto?.categoria?.alicuota_iva ?? 21,
        })),
      ),
    [compra.items],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">
              {compra.proveedor?.nombre_comercial ?? compra.proveedor?.razon_social ?? "Proveedor"}
            </h2>
            <p className="mt-[2px] text-[12.5px] text-text-3">
              {compra.numero_factura ?? "Sin número de comprobante"}
              {compra.fecha_factura ? ` · ${compra.fecha_factura}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ComprobanteBadge tipo={compra.tipo_comprobante} />
            <EstadoCompraBadge estado={compra.estado} />
          </div>
        </div>

        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[12px] text-text-2">Total pagado</p>
              <p className="text-[22px] font-semibold leading-[1.25] tabular-nums text-text">
                {formatoMonedaExacto.format(totalPagado)}
              </p>
              {hayDesglose ? (
                <button
                  type="button"
                  onClick={() => setVerDesglose((v) => !v)}
                  className="mt-[2px] text-[12.5px] font-medium text-moe hover:underline"
                >
                  {verDesglose ? "Ocultar desglose" : "Ver desglose"}
                </button>
              ) : (
                <p className="mt-[2px] text-[12px] text-text-3">
                  Es lo que suman las líneas: esta compra no tiene cargado el pie de la factura.
                </p>
              )}
            </div>

            {hayDesglose && verDesglose && (
              <div className="w-full rounded-[6px] border border-border bg-bg-2 px-[12px] py-[10px] sm:w-[330px]">
                <FilaDesglose
                  label="Productos"
                  ayuda={`${compra.items.length} ${
                    compra.items.length === 1 ? "línea" : "líneas"
                  } · ${unidades} u. — el detalle, abajo`}
                  monto={compra.total}
                  apagado
                />
                <div className="my-[7px] border-t border-border" />
                {hayPie && (
                  <>
                    <FilaDesglose label="Neto gravado" monto={compra.neto_gravado ?? 0} />
                    {!!compra.impuestos_internos && (
                      <FilaDesglose label="Impuestos internos" monto={compra.impuestos_internos} />
                    )}
                    <FilaDesglose label="IVA" monto={compra.iva ?? 0} />
                    {!!compra.percepcion_iva && (
                      <FilaDesglose label="Percepción IVA" monto={compra.percepcion_iva} />
                    )}
                    {!!compra.percepcion_iibb && (
                      <FilaDesglose label="Percepción IIBB" monto={compra.percepcion_iibb} />
                    )}
                  </>
                )}
                {!!compra.flete && (
                  <FilaDesglose
                    label="Flete"
                    ayuda="Se pagó aparte, no está en la factura"
                    monto={compra.flete}
                  />
                )}
                <div className="my-[7px] border-t border-border" />
                <FilaDesglose label="Total pagado" monto={totalPagado} fuerte />
              </div>
            )}
          </div>

          <p className="mt-[6px] text-[12.5px] text-text-2">
            {compra.tipo_comprobante === "factura_a" ? (
              <span className="text-ok">Descuenta IVA</span>
            ) : compra.tipo_comprobante === "factura_b" ? (
              "Factura B: no discrimina IVA, así que esta compra no descuenta IVA."
            ) : compra.tipo_comprobante === "remito" ? (
              "Llegó con remito: esta compra no descuenta IVA."
            ) : (
              "Esta compra se cargó antes de que el sistema pidiera el comprobante, así que no sabemos con qué vino."
            )}
          </p>

          {puedeReclasificar && !editando && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="mt-2 text-[12.5px] font-medium text-moe hover:underline"
            >
              {compra.tipo_comprobante === "factura_a" || compra.tipo_comprobante === "factura_b"
                ? "Corregir comprobante"
                : "Cargar la factura"}
            </button>
          )}

          {editando && (
            <ComprobanteForm
              compra={compra}
              netoSugerido={desgloseSugerido.neto}
              ivaSugerido={desgloseSugerido.iva}
              onCancelar={() => setEditando(false)}
              onListo={() => {
                setEditando(false);
                router.refresh();
              }}
            />
          )}
        </div>

        {reclasificaciones.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-[5px] text-[12px] font-medium text-text-2">Cambios del comprobante</p>
            <div className="flex flex-col gap-[3px]">
              {reclasificaciones.map((r) => (
                <p key={r.id} className="text-[12px] text-text-3">
                  {formatoFechaHora.format(new Date(r.fecha))} · {r.usuario?.nombre ?? "—"} ·{" "}
                  {r.tipo_anterior ? TIPO_COMPROBANTE_LABEL[r.tipo_anterior] : "Sin clasificar"} →{" "}
                  {TIPO_COMPROBANTE_LABEL[r.tipo_nuevo]}
                  {r.numero_nuevo ? ` (${r.numero_nuevo})` : ""}
                  {/* Una corrección puede ser solo del flete: ahí el tipo de
                      comprobante queda igual y lo que cambió es este número. */}
                  {r.flete_nuevo !== r.flete_anterior
                    ? ` · flete ${formatoMonedaExacto.format(r.flete_nuevo ?? 0)}`
                    : ""}{" "}
                  — {r.motivo}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border px-[14px] py-[11px]">
          <h3 className="text-[13px] font-semibold text-text">Líneas</h3>
          {hayDesglose && (
            <p className="text-[11.5px] text-text-3">
              El costo con impuestos es el que el sistema toma como costo del producto: reparte{" "}
              {hayPie && compra.flete
                ? "el IVA, las percepciones y el flete"
                : hayPie
                  ? "el IVA y las percepciones de la factura"
                  : "el flete"}{" "}
              entre las líneas (acá, ×{" "}
              {factorImpuestos.toLocaleString("es-AR", { maximumFractionDigits: 3 })}).
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  SKU
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Cantidad
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Costo unit.
                </th>
                {hayPie && (
                  <th
                    className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2"
                    title="Lo que salió cada unidad con el IVA y las percepciones de la factura repartidos"
                  >
                    Costo con impuestos
                  </th>
                )}
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Subtotal
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Vencimiento
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Recibido
                </th>
              </tr>
            </thead>
            <tbody>
              {compra.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={hayPie ? 7 : 6}
                    className="px-[14px] py-[16px] text-center text-[12.5px] text-text-3"
                  >
                    Todavía no hay líneas en esta compra.
                  </td>
                </tr>
              ) : (
                compra.items.map((item) => (
                  <tr key={item.id} className="border-b border-[#F1F1F3] last:border-b-0">
                    <td className="px-[14px] py-[9px] align-middle">
                      <p className="font-medium text-text">{nombreSku(item.sku)}</p>
                      <p className="text-[11.5px] text-text-3">{presentacionSku(item.sku)}</p>
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {item.cantidad}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {formatoMoneda.format(item.costo_unitario)}
                    </td>
                    {hayPie && (
                      <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
                        {formatoMoneda.format(
                          item.costo_con_impuestos ??
                            redondearPeso(item.costo_unitario * factorImpuestos),
                        )}
                      </td>
                    )}
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text">
                      {formatoMoneda.format(item.subtotal)}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {formatoVencimiento(item.fecha_vencimiento)}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {item.recibido_previo}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-[14px] py-[10px]">
          <p className="text-[13px] font-semibold text-text">
            Total de los productos:{" "}
            <span className="tabular-nums">{formatoMonedaExacto.format(compra.total)}</span>
          </p>
          {hayPie && (
            <p className="text-[12px] text-text-3">
              Sin impuestos — lo pagado está arriba de todo.
            </p>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="border-b border-border px-[14px] py-[11px]">
          <h3 className="text-[13px] font-semibold text-text">Recepción</h3>
        </div>

        {recepciones.length === 0 ? (
          <div className="px-[14px] py-[22px] text-center">
            <p className="text-[12.5px] text-text-3">Esta compra todavía no tiene recepción registrada.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {recepciones.map((r) => (
              <div key={r.id} className="border-b border-[#F1F1F3] px-[14px] py-[10px] last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] text-text-2">
                    {formatoFechaHora.format(new Date(r.fecha))} · {r.usuario?.nombre ?? "—"}
                  </p>
                  <span
                    className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
                      r.estado === "recibida" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"
                    }`}
                  >
                    {r.estado === "recibida" ? "Recibida" : "Pendiente"}
                  </span>
                </div>
                <div className="mt-[6px] flex flex-col gap-[3px]">
                  {r.recepcion_items.map((ri) => {
                    const item = itemsPorId.get(ri.compra_item_id);
                    return (
                      <p key={ri.compra_item_id} className="text-[12.5px] text-text-2">
                        {nombreSku(item?.sku ?? null)}: {ri.cantidad_recibida}
                        {ri.diferencia != null && ri.diferencia !== 0 && (
                          <span className="text-warn">
                            {" "}
                            (diferencia {ri.diferencia > 0 ? "+" : ""}
                            {ri.diferencia}
                            {ri.motivo_diferencia ? ` — ${ri.motivo_diferencia}` : ""})
                          </span>
                        )}
                      </p>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
