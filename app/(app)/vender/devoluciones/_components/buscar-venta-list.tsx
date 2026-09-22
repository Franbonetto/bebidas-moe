"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatoMoneda } from "../../_lib/formato";
import { formatoFechaHora } from "@/app/(app)/compras/_lib/formato";

export type VentaRow = {
  id: string;
  fecha: string;
  medioPago: string;
  total: number;
  resumen: string;
  textoBusqueda: string;
};

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  qr: "QR",
  mixto: "Pago combinado",
};

export function BuscarVentaList({ ventas }: { ventas: VentaRow[] }) {
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
        <p className="mt-[6px] text-[11.5px] text-text-3">
          Ventas de los últimos 90 días. Sin límite de tiempo para devolver — si es más vieja, avisá para
          ampliar la búsqueda.
        </p>
      </div>

      {filtradas.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          <p className="mb-[3px] text-[13.5px] font-semibold text-text">No se encontraron ventas</p>
          <p className="text-[12.5px] text-text-3">Probá con otro producto o marca.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {filtradas.map((v) => (
            <Link
              key={v.id}
              href={`/vender/devoluciones/${v.id}`}
              className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[11px] last:border-b-0 hover:bg-bg-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-text">{v.resumen || "Sin productos"}</p>
                <p className="text-[11.5px] text-text-3">
                  {formatoFechaHora.format(new Date(v.fecha))} · {MEDIO_LABEL[v.medioPago] ?? v.medioPago}
                </p>
              </div>
              <span className="shrink-0 tabular-nums text-[13px] font-medium text-text">
                {formatoMoneda.format(v.total)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
