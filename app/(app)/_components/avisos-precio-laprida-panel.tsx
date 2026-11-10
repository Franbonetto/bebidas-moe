"use client";

import { useState, useTransition } from "react";
import {
  marcarAvisoPrecioResuelto,
  marcarTodosAvisosPrecioResueltos,
  verPrecioAviso,
} from "../_actions/avisos-precio-laprida";
import type { AvisoPrecioLaprida, PrecioParaCartel } from "@/lib/avisos-precio-laprida";
import { formatoMoneda } from "../compras/_lib/formato";

type ResultadoPrecio = { error: string } | { ok: true; datos: PrecioParaCartel };

// El precio que rige hoy: el de lista (débito, crédito, transferencia y QR),
// el de efectivo si es distinto, y las promociones que corren en Laprida
// (que aplican solo pagando en efectivo).
function DetallePrecio({ datos }: { datos: PrecioParaCartel }) {
  const sinNada = datos.precio == null && datos.promociones.length === 0;
  return (
    <div className="flex flex-col gap-[3px]">
      {datos.precio != null && (
        <p className="text-text">
          <span className="font-semibold tabular-nums">{formatoMoneda.format(datos.precio)}</span>
          <span className="text-text-3"> precio{datos.precioEfectivo != null ? " (otros medios de pago)" : ""}</span>
        </p>
      )}
      {datos.precioEfectivo != null && (
        <p className="text-text">
          <span className="font-semibold tabular-nums">{formatoMoneda.format(datos.precioEfectivo)}</span>
          <span className="text-text-3"> en efectivo</span>
        </p>
      )}
      {datos.promociones.map((p) => (
        <p key={`${p.nombre}:${p.detalle}`} className="text-text">
          <span className="font-medium">Promo {p.nombre}:</span>{" "}
          {p.total != null ? (
            <span className="font-semibold tabular-nums">{formatoMoneda.format(p.total)}</span>
          ) : (
            <span className="text-text-3">sin precio cargado para Laprida</span>
          )}
          <span className="text-text-3">
            {" "}
            ({p.detalle}, pagando en efectivo{p.vigencia ? `, ${p.vigencia}` : ""})
            {!p.vigente && " · ya no está vigente"}
          </span>
        </p>
      ))}
      {sinNada && <p className="text-text-3">Todavía no tiene precio cargado.</p>}
    </div>
  );
}

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
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [precios, setPrecios] = useState<Record<string, ResultadoPrecio>>({});

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

  // "Ver precio": se busca la primera vez que se abre y queda guardado en
  // esta pantalla; no se vuelve a pedir al ocultar y mostrar.
  function alternarPrecio(aviso: AvisoPrecioLaprida) {
    const yaAbierto = abiertos.has(aviso.id);
    setAbiertos((prev) => {
      const nuevo = new Set(prev);
      if (yaAbierto) nuevo.delete(aviso.id);
      else nuevo.add(aviso.id);
      return nuevo;
    });
    if (yaAbierto || precios[aviso.id] !== undefined) return;
    verPrecioAviso(aviso.skuId, aviso.promocionId).then((resultado) =>
      setPrecios((prev) => ({ ...prev, [aviso.id]: resultado })),
    );
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
        {visibles.map((a) => {
          const abierto = abiertos.has(a.id);
          const precio = precios[a.id];
          return (
            <div key={a.id} className="px-[14px] py-[5px]">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-[13px] text-text">
                  <span className="font-medium">{a.titulo}</span>
                  <span className="text-[11.5px] text-text-3"> · {a.descripcion}</span>
                </p>
                <div className="flex shrink-0 gap-[6px]">
                  <button
                    type="button"
                    onClick={() => alternarPrecio(a)}
                    aria-expanded={abierto}
                    className="whitespace-nowrap rounded-[6px] border border-border bg-bg px-[8px] py-[3px] text-[12px] font-medium text-text-2 hover:bg-bg-2"
                  >
                    {abierto ? "Ocultar precio" : "Ver precio"}
                  </button>
                  <button
                    type="button"
                    onClick={() => resolver(a)}
                    disabled={pending}
                    className="whitespace-nowrap rounded-[6px] border border-err/40 bg-bg px-[8px] py-[3px] text-[12px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
                  >
                    Ya lo cambié
                  </button>
                </div>
              </div>
              {abierto && (
                <div className="mb-[3px] mt-[5px] rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[12.5px]">
                  {precio === undefined ? (
                    <p className="text-text-3">Buscando el precio…</p>
                  ) : "error" in precio ? (
                    <p className="text-err">{precio.error}</p>
                  ) : (
                    <DetallePrecio datos={precio.datos} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="border-t border-err/25 px-[14px] py-[8px] text-[12px] text-err">{error}</p>}
    </div>
  );
}
