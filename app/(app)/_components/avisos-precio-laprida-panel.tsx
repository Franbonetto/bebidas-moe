"use client";

import { useState, useTransition } from "react";
import { marcarAvisoPrecioResuelto, marcarTodosAvisosPrecioResueltos } from "../_actions/avisos-precio-laprida";
import type { AvisoPrecioLaprida } from "@/lib/avisos-precio-laprida";

// Rojo a propósito (no el warn amarillo de siempre): esto es un precio
// que hoy está mal en la góndola, no una advertencia preventiva.
//
// La lista tiene su propio scroll (pedido del usuario 2026-11-10): con
// muchos cambios pendientes ocupaba toda la pantalla hacia abajo. El botón
// "Ya cambié todos" resuelve todos los pendientes; como es masivo, pide una
// confirmación en el lugar antes de hacerlo.
export function AvisosPrecioLapridaPanel({ avisos }: { avisos: AvisoPrecioLaprida[] }) {
  const [resueltos, setResueltos] = useState<Set<string>>(new Set());
  const [todosResueltos, setTodosResueltos] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visibles = todosResueltos ? [] : avisos.filter((a) => !resueltos.has(a.id));
  if (visibles.length === 0) return null;

  function resolver(aviso: AvisoPrecioLaprida) {
    setError(null);
    startTransition(async () => {
      const resultado = await marcarAvisoPrecioResuelto(aviso.ids);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      setResueltos((prev) => new Set(prev).add(aviso.id));
    });
  }

  function resolverTodos() {
    setError(null);
    startTransition(async () => {
      const resultado = await marcarTodosAvisosPrecioResueltos();
      if ("error" in resultado) {
        setError(resultado.error);
        setConfirmando(false);
        return;
      }
      setTodosResueltos(true);
    });
  }

  return (
    <div className="overflow-hidden rounded-card border border-err/40 bg-err-bg">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-err/25 px-[14px] py-[9px]">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-err">
            {visibles.length} cartel{visibles.length === 1 ? "" : "es"} para cambiar en la góndola
          </h2>
          <p className="text-[12px] text-err/80">
            Cambiá el cartel del producto y marcalo como hecho.
          </p>
        </div>
        {confirmando ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-err">¿Cambiaste todos?</span>
            <button
              type="button"
              onClick={resolverTodos}
              disabled={pending}
              className="rounded-[6px] bg-err px-[10px] py-[5px] text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              Sí, ya están
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={pending}
              className="rounded-[6px] border border-err/40 bg-bg px-[10px] py-[5px] text-[12px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={pending}
            className="shrink-0 whitespace-nowrap rounded-[6px] border border-err/40 bg-bg px-[10px] py-[5px] text-[12px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
          >
            Ya cambié todos los carteles
          </button>
        )}
      </div>
      <div className="max-h-[260px] divide-y divide-err/15 overflow-y-auto overscroll-contain">
        {visibles.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 px-[14px] py-[5px]">
            <p className="min-w-0 truncate text-[13px] text-text">
              <span className="font-medium">{a.titulo}</span>
              <span className="text-[11.5px] text-text-3"> · {a.descripcion}</span>
            </p>
            <button
              type="button"
              onClick={() => resolver(a)}
              disabled={pending}
              className="shrink-0 whitespace-nowrap rounded-[6px] border border-err/40 bg-bg px-[8px] py-[3px] text-[12px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
            >
              Ya lo cambié
            </button>
          </div>
        ))}
      </div>
      {error && <p className="border-t border-err/25 px-[14px] py-[8px] text-[12px] text-err">{error}</p>}
    </div>
  );
}
