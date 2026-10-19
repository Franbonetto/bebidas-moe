"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { verificarPin } from "../_actions/pin";

// Puerta de PIN para las pantallas sensibles (pedido del usuario
// 2026-10-19: entrada de mercadería, ajuste de stock, precios,
// promociones y carga inicial). Ver lib/pin.ts para el por qué.
//
// Se pide UNA VEZ POR PANTALLA: el provider envuelve la pantalla entera,
// así todos los paneles de /precios comparten el mismo desbloqueo en vez
// de pedir un PIN cada uno. Al recargar o salir, se vuelve a pedir.
//
// El PIN queda en memoria del navegador (no en localStorage: no tiene que
// sobrevivir a un refresh) y viaja en cada acción, porque el servidor lo
// valida siempre -- el desbloqueo de pantalla es comodidad, no seguridad.

type PedirPin = () => Promise<string | null>;

const PinContext = createContext<PedirPin | null>(null);

export function usePinOperaciones(): PedirPin {
  const pedir = useContext(PinContext);
  if (!pedir) {
    throw new Error("usePinOperaciones necesita un <PinProvider> arriba en el árbol");
  }
  return pedir;
}

export function PinProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  const pinRef = useRef<string | null>(null);
  const resolverRef = useRef<((pin: string | null) => void) | null>(null);

  const pedir = useCallback<PedirPin>(() => {
    // Ya desbloqueada: no molestar de nuevo.
    if (pinRef.current) return Promise.resolve(pinRef.current);

    setValor("");
    setError(null);
    setAbierto(true);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  function responder(pin: string | null) {
    setAbierto(false);
    const resolver = resolverRef.current;
    resolverRef.current = null;
    resolver?.(pin);
  }

  async function confirmar() {
    const pin = valor.trim();
    if (!pin) {
      setError("Escribí el PIN.");
      return;
    }

    setVerificando(true);
    const resultado = await verificarPin(pin);
    setVerificando(false);

    if ("error" in resultado) {
      setError(resultado.error);
      setValor("");
      return;
    }

    pinRef.current = pin;
    responder(pin);
  }

  return (
    <PinContext.Provider value={pedir}>
      {children}

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => responder(null)}
        >
          <div
            className="w-[320px] rounded-card border border-border bg-bg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-[15.5px] font-semibold text-text">PIN para confirmar</h2>
            <p className="mb-3 text-[13px] text-text-2">
              Este cambio necesita el PIN. Se pide una sola vez por pantalla.
            </p>

            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!verificando) confirmar();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  responder(null);
                }
              }}
              placeholder="••••"
              className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[8px] text-center text-[17px] tracking-[0.3em] tabular-nums text-text outline-none focus:border-moe"
            />

            {error && <p className="mt-2 text-[13px] text-err">{error}</p>}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => responder(null)}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[14px] font-medium text-text-2 hover:bg-bg-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={verificando}
                onClick={confirmar}
                className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[14px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                {verificando ? "Verificando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PinContext.Provider>
  );
}
