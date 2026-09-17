"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatoMoneda } from "../../_lib/formato";
import { formatoFechaHora } from "@/app/(app)/compras/_lib/formato";

export type VentaFacturarRow = {
  id: string;
  fecha: string;
  medioPago: string;
  total: number;
  estadoComprobante: string | null;
  resumen: string;
  textoBusqueda: string;
};

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  autorizado: { label: "Facturada", className: "bg-ok-bg text-ok" },
  pendiente: { label: "Pendiente", className: "bg-info-bg text-info" },
  rechazado: { label: "Rechazada", className: "bg-err-bg text-err" },
  error: { label: "Con error", className: "bg-warn-bg text-warn" },
};

export function BuscarVentaFacturarList({
  ventas,
  sucursalNombre,
}: {
  ventas: VentaFacturarRow[];
  sucursalNombre: string;
}) {
  const [query, setQuery] = useState("");

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ventas;
    return ventas.filter((v) => v.textoBusqueda.toLowerCase().includes(q));
  }, [ventas, query]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="border-b border-border p-[12px]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por producto o marca…"
          className="w-full rounded-[6px] border border-border bg-bg-2 px-[10px] py-[7px] text-[13px] text-text outline-none focus:border-moe"
        />
        <p className="mt-[6px] text-[11.5px] text-text-3">Ventas de {sucursalNombre} de los últimos 90 días.</p>
      </div>

      {filtradas.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          <p className="mb-[3px] text-[13.5px] font-semibold text-text">No se encontraron ventas</p>
          <p className="text-[12.5px] text-text-3">Probá con otro producto o marca.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {filtradas.map((v) => {
            const badge = v.estadoComprobante ? ESTADO_BADGE[v.estadoComprobante] : null;
            return (
              <Link
                key={v.id}
                href={`/vender/facturar/${v.id}`}
                className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[11px] last:border-b-0 hover:bg-bg-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-text">{v.resumen || "Sin productos"}</p>
                  <p className="text-[11.5px] text-text-3">
                    {formatoFechaHora.format(new Date(v.fecha))} · {MEDIO_LABEL[v.medioPago] ?? v.medioPago}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {badge && (
                    <span className={`rounded-[5px] px-[7px] py-[2px] text-[11px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  <span className="tabular-nums text-[13px] font-medium text-text">
                    {formatoMoneda.format(v.total)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
