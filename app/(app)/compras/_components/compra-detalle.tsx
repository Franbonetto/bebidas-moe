"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { formatoFechaHora, formatoMoneda } from "../_lib/formato";
import {
  TIPOS_COMPROBANTE,
  TIPO_COMPROBANTE_AYUDA,
  TIPO_COMPROBANTE_LABEL,
  desglosarIvaCompra,
  redondearPeso,
  type TipoComprobante,
} from "../_lib/comprobante";
import { reclasificarComprobanteCompra } from "../actions";
import { ComprobanteBadge, EstadoCompraBadge, type Compra } from "./compras-table";

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
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const esFactura = tipo === "factura_a" || tipo === "factura_b";
  const discriminaIva = tipo === "factura_a";
  const netoMostrado = neto ?? redondearPeso(netoSugerido).toFixed(2);
  const ivaMostrado = iva ?? redondearPeso(ivaSugerido).toFixed(2);

  function guardar() {
    setError(null);
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
        motivo,
      });

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
          {compra.tipo_comprobante === "factura_a" ? (
            <div className="flex flex-wrap gap-x-[22px] gap-y-[4px] text-[12.5px] text-text-2">
              <span>
                Neto gravado:{" "}
                <b className="font-medium tabular-nums text-text">
                  {formatoMoneda.format(compra.neto_gravado ?? 0)}
                </b>
              </span>
              <span>
                IVA:{" "}
                <b className="font-medium tabular-nums text-text">
                  {formatoMoneda.format(compra.iva ?? 0)}
                </b>
              </span>
              {compra.impuestos_internos !== null && compra.impuestos_internos > 0 && (
                <span>
                  Impuestos internos:{" "}
                  <b className="font-medium tabular-nums text-text">
                    {formatoMoneda.format(compra.impuestos_internos)}
                  </b>
                </span>
              )}
              {compra.percepcion_iva !== null && compra.percepcion_iva > 0 && (
                <span>
                  Percepción IVA:{" "}
                  <b className="font-medium tabular-nums text-text">
                    {formatoMoneda.format(compra.percepcion_iva)}
                  </b>
                </span>
              )}
              {compra.percepcion_iibb !== null && compra.percepcion_iibb > 0 && (
                <span>
                  Percepción IIBB:{" "}
                  <b className="font-medium tabular-nums text-text">
                    {formatoMoneda.format(compra.percepcion_iibb)}
                  </b>
                </span>
              )}
              <span className="text-ok">Descuenta IVA</span>
            </div>
          ) : (
            <p className="text-[12.5px] text-text-2">
              {compra.tipo_comprobante === "factura_b"
                ? "Factura B: no discrimina IVA, así que esta compra no descuenta IVA."
                : compra.tipo_comprobante === "remito"
                  ? "Llegó con remito: esta compra no descuenta IVA."
                  : "Esta compra se cargó antes de que el sistema pidiera el comprobante, así que no sabemos con qué vino."}
            </p>
          )}

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
                  {r.numero_nuevo ? ` (${r.numero_nuevo})` : ""} — {r.motivo}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border px-[14px] py-[11px]">
          <h3 className="text-[13px] font-semibold text-text">Líneas</h3>
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
                  <td colSpan={6} className="px-[14px] py-[16px] text-center text-[12.5px] text-text-3">
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

        <div className="flex items-center justify-between border-t border-border px-[14px] py-[10px]">
          <p className="text-[13px] font-semibold text-text">
            Total: <span className="tabular-nums">{formatoMoneda.format(compra.total)}</span>
          </p>
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
