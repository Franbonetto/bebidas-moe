"use client";

import { useMemo } from "react";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { formatoFechaHora, formatoMoneda } from "../_lib/formato";
import { EstadoCompraBadge, type Compra } from "./compras-table";

type SkuInfo = SkuPresentacion & {
  nombre: string;
  codigo_interno: string;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
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

// Solo lectura: toda compra se carga y recibe en un solo paso desde
// "Cargar mercadería" (cargar_compra_directa()), así que para cuando esta
// pantalla existe la compra ya está cerrada -- no hay borrador para editar
// ni recepciones parciales para armar a mano (decisión del usuario
// 2026-09-21: "no trabaja así el local", se sacó el flujo de "Nueva
// compra" en varias tandas).
export function CompraDetalle({
  compra,
  recepciones,
}: {
  compra: CompraDetalleData;
  recepciones: RecepcionDetalle[];
}) {
  const itemsPorId = useMemo(() => new Map(compra.items.map((i) => [i.id, i])), [compra.items]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">
              {compra.proveedor?.nombre_comercial ?? compra.proveedor?.razon_social ?? "Proveedor"}
            </h2>
            <p className="mt-[2px] text-[12.5px] text-text-3">
              {compra.numero_factura ? `Factura ${compra.numero_factura}` : "Sin número de factura"}
              {compra.fecha_factura ? ` · ${compra.fecha_factura}` : ""}
            </p>
          </div>
          <EstadoCompraBadge estado={compra.estado} />
        </div>
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
