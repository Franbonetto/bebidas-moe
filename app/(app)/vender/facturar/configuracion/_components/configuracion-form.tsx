"use client";

import { useState, useTransition } from "react";
import { guardarPuntoVenta, sincronizarCondicionesIva } from "../../actions";

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";

type CondicionIvaRow = { id: string; codigo_arca: number; nombre: string };

export function ConfiguracionForm({
  sucursalId,
  sucursalNombre,
  numeroArcaActual,
  condiciones,
  mostrarCondicionesIva = true,
}: {
  sucursalId: string;
  sucursalNombre: string;
  numeroArcaActual: number | null;
  condiciones: CondicionIvaRow[];
  // Las condiciones de IVA son un catálogo global de ARCA, no por
  // sucursal -- cuando se lista un punto de venta por sucursal (más de
  // una sucursal factura), esa sección solo se muestra una vez.
  mostrarCondicionesIva?: boolean;
}) {
  const [numeroArca, setNumeroArca] = useState(numeroArcaActual?.toString() ?? "");
  const [mensajePunto, setMensajePunto] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [mensajeSync, setMensajeSync] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pendingPunto, startTransitionPunto] = useTransition();
  const [pendingSync, startTransitionSync] = useTransition();

  function guardar() {
    const numero = Number(numeroArca);
    if (!Number.isInteger(numero) || numero <= 0) {
      setMensajePunto({ tipo: "error", texto: "El número de punto de venta ARCA tiene que ser un entero positivo." });
      return;
    }

    startTransitionPunto(async () => {
      const resultado = await guardarPuntoVenta(sucursalId, numero);
      setMensajePunto(
        "error" in resultado ? { tipo: "error", texto: resultado.error } : { tipo: "ok", texto: "Guardado." },
      );
    });
  }

  function sincronizar() {
    startTransitionSync(async () => {
      const resultado = await sincronizarCondicionesIva();
      setMensajeSync(
        "error" in resultado
          ? { tipo: "error", texto: resultado.error }
          : { tipo: "ok", texto: `Sincronizadas ${resultado.cantidad} condiciones de IVA.` },
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-4">
        <h2 className="mb-1 text-[13px] font-semibold text-text">Punto de venta ARCA — {sucursalNombre}</h2>
        <p className="mb-3 text-[11.5px] text-text-3">
          El número que ARCA asignó al dar de alta el punto de venta electrónico para esta sucursal.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-[12px] font-medium text-text-2">Número de punto de venta</label>
            <input
              type="text"
              inputMode="numeric"
              value={numeroArca}
              onChange={(e) => setNumeroArca(e.target.value)}
              placeholder="Ej. 1"
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={guardar}
            disabled={pendingPunto}
            className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {pendingPunto ? "Guardando…" : "Guardar"}
          </button>
        </div>
        {mensajePunto && (
          <p className={`mt-2 text-[12.5px] ${mensajePunto.tipo === "error" ? "text-err" : "text-ok"}`}>
            {mensajePunto.texto}
          </p>
        )}
      </div>

      {mostrarCondicionesIva && (
      <div className="rounded-card border border-border bg-bg p-4">
        <h2 className="mb-1 text-[13px] font-semibold text-text">Condiciones de IVA del receptor</h2>
        <p className="mb-3 text-[11.5px] text-text-3">
          Catálogo que ARCA exige informar en cada comprobante (RG 5616). Se sincroniza a mano, no hace falta
          repetirlo salvo que ARCA agregue una condición nueva.
        </p>

        {condiciones.length > 0 && (
          <div className="mb-3 flex flex-col gap-1">
            {condiciones.map((c) => (
              <div key={c.id} className="flex justify-between text-[12.5px] text-text-2">
                <span>{c.nombre}</span>
                <span className="tabular-nums text-text-3">#{c.codigo_arca}</span>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={sincronizar}
          disabled={pendingSync}
          className="rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[12.5px] font-medium text-text-2 hover:bg-bg-2 disabled:opacity-60"
        >
          {pendingSync ? "Sincronizando…" : "Sincronizar condiciones de IVA"}
        </button>
        {mensajeSync && (
          <p className={`mt-2 text-[12.5px] ${mensajeSync.tipo === "error" ? "text-err" : "text-ok"}`}>
            {mensajeSync.texto}
          </p>
        )}
      </div>
      )}
    </div>
  );
}
