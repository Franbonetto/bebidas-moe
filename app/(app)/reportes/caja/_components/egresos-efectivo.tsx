"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import type { GrupoEgresos } from "../_lib/egresos";

// El número de "Egresos de efectivo" es un botón (pedido del usuario
// 2026-11-10): al tocarlo se abre el detalle de todo lo que salió del cajón
// en efectivo, día por día y con la nota que escribió quien lo hizo.
export function EgresosEfectivo({
  total,
  sub,
  grupos,
}: {
  total: number;
  sub: ReactNode;
  grupos: GrupoEgresos[];
}) {
  const [abierto, setAbierto] = useState(false);
  const cantidad = grupos.reduce((acc, g) => acc + g.items.length, 0);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-card border border-border bg-bg p-[15px] text-left hover:border-moe hover:bg-bg-2"
      >
        <div className="mb-[5px] text-[12px] font-medium text-text-2">Egresos de efectivo</div>
        <div className="text-[23px] font-semibold tracking-tight tabular-nums text-text">
          {formatoMoneda.format(total)}
        </div>
        <div className="mt-[5px] text-[12px] text-text-3">{sub}</div>
        <div className="mt-[6px] text-[12px] font-medium text-moe">Ver el detalle día por día</div>
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setAbierto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Egresos de efectivo"
            className="flex max-h-[85vh] w-[640px] max-w-full flex-col rounded-card border border-border bg-bg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[15.5px] font-semibold text-text">Egresos de efectivo</h2>
                <p className="mt-[2px] text-[12.5px] text-text-3">
                  {cantidad === 0
                    ? "No salió plata del cajón en este período."
                    : `${cantidad} egreso${cantidad === 1 ? "" : "s"} · ${formatoMoneda.format(total)} en total. Salidas de caja y devoluciones pagadas en efectivo.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="shrink-0 rounded-[6px] border border-border bg-bg px-[10px] py-[4px] text-[12.5px] font-medium text-text-2 hover:bg-bg-2"
              >
                Cerrar
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain">
              {grupos.map((g) => (
                <section key={g.dia}>
                  <div className="sticky top-0 flex items-baseline justify-between gap-3 border-b border-border bg-bg-2 px-5 py-[7px]">
                    <h3 className="text-[12.5px] font-semibold capitalize text-text">{g.etiqueta}</h3>
                    <span className="text-[12.5px] font-medium tabular-nums text-err">
                      −{formatoMoneda.format(g.total)}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {g.items.map((e, i) => (
                      <li
                        key={`${e.creadoEn}:${i}`}
                        className="flex items-start justify-between gap-3 px-5 py-[9px]"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] text-text">{e.nota}</p>
                          <p className="mt-[2px] text-[11.5px] text-text-3">
                            <span className="tabular-nums">{e.hora}</span> · {e.quien}
                            {e.tipo === "devolucion" ? " · Devolución en efectivo" : " · Salida de caja"}
                            {e.ventaId && (
                              <>
                                {" · "}
                                <a
                                  href={`/ticket/${e.ventaId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-moe hover:underline"
                                >
                                  Ver venta
                                </a>
                              </>
                            )}
                          </p>
                        </div>
                        <span className="shrink-0 text-[13px] font-medium tabular-nums text-err">
                          −{formatoMoneda.format(e.monto)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
