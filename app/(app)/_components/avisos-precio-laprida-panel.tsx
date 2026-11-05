"use client";

import { useState, useTransition } from "react";
import { marcarAvisoPrecioResuelto } from "../_actions/avisos-precio-laprida";
import type { AvisoPrecioLaprida } from "@/lib/avisos-precio-laprida";

// Rojo a propósito (no el warn amarillo de siempre): esto es un precio
// que hoy está mal en la góndola, no una advertencia preventiva.
export function AvisosPrecioLapridaPanel({ avisos }: { avisos: AvisoPrecioLaprida[] }) {
  const [resueltos, setResueltos] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visibles = avisos.filter((a) => !resueltos.has(a.id));
  if (visibles.length === 0) return null;

  function resolver(id: string) {
    setError(null);
    startTransition(async () => {
      const resultado = await marcarAvisoPrecioResuelto(id);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      setResueltos((prev) => new Set(prev).add(id));
    });
  }

  return (
    <div className="overflow-hidden rounded-card border border-err/40 bg-err-bg">
      <div className="border-b border-err/25 px-[14px] py-[10px]">
        <h2 className="text-[13px] font-semibold text-err">
          {visibles.length} cambio{visibles.length === 1 ? "" : "s"} de precio o promoción sin aplicar en
          la góndola
        </h2>
        <p className="mt-[2px] text-[12px] text-err/80">
          Cambiá el cartel del producto y marcalo como hecho.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-err/15">
        {visibles.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 px-[14px] py-[10px]">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-text">{a.titulo}</p>
              <p className="text-[11.5px] text-text-3">{a.descripcion}</p>
            </div>
            <button
              type="button"
              onClick={() => resolver(a.id)}
              disabled={pending}
              className="shrink-0 whitespace-nowrap rounded-[6px] border border-err/40 bg-bg px-[10px] py-[6px] text-[12.5px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
            >
              Ya cambié el cartel
            </button>
          </div>
        ))}
      </div>
      {error && <p className="border-t border-err/25 px-[14px] py-[8px] text-[12px] text-err">{error}</p>}
    </div>
  );
}
