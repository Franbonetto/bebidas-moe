"use client";

import { useEffect, useState } from "react";
import { obtenerMovimientosSku, type MovimientoSku } from "../actions";
import { formatoFechaHora } from "../../compras/_lib/formato";
import { TIPO_MOVIMIENTO_LABEL, motivoLegible } from "@/lib/movimientos";

export function MovimientosSkuModal({
  skuId,
  nombre,
  presentacion,
  onClose,
}: {
  skuId: string;
  nombre: string;
  presentacion: string;
  onClose: () => void;
}) {
  const [movimientos, setMovimientos] = useState<MovimientoSku[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    obtenerMovimientosSku(skuId).then((resultado) => {
      if (!activo) return;
      if ("error" in resultado) setError(resultado.error);
      else setMovimientos(resultado.movimientos);
    });
    return () => {
      activo = false;
    };
  }, [skuId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-[560px] overflow-y-auto rounded-card border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-text">{nombre}</h2>
            <p className="text-[12px] text-text-3">{presentacion}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12.5px] text-text-3 hover:text-text"
          >
            Cerrar
          </button>
        </div>

        {error && <p className="text-[12.5px] text-err">{error}</p>}

        {!error && movimientos === null && (
          <p className="py-[20px] text-center text-[12.5px] text-text-3">Cargando movimientos…</p>
        )}

        {movimientos !== null && movimientos.length === 0 && (
          <p className="py-[20px] text-center text-[12.5px] text-text-3">
            Todavía no hay movimientos registrados para este SKU.
          </p>
        )}

        {movimientos !== null && movimientos.length > 0 && (
          <div className="flex flex-col divide-y divide-[#F1F1F3]">
            {movimientos.map((m) => (
              <div key={m.id} className="py-[9px] text-[12.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text">{TIPO_MOVIMIENTO_LABEL[m.tipo] ?? m.tipo}</span>
                  <span className={`tabular-nums font-medium ${m.cantidad > 0 ? "text-ok" : "text-err"}`}>
                    {m.cantidad > 0 ? "+" : ""}
                    {m.cantidad}
                  </span>
                </div>
                <p className="text-text-3">
                  {m.sucursal?.nombre ?? "—"} · {m.usuario?.nombre ?? "—"} ·{" "}
                  {formatoFechaHora.format(new Date(m.fecha))}
                  {motivoLegible(m.motivo, m.tipo) ? ` — ${motivoLegible(m.motivo, m.tipo)}` : ""}
                </p>
                <p className="text-text-3">
                  Stock: {m.stock_anterior} → {m.stock_posterior}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
