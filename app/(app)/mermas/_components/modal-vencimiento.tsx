"use client";

import { useState } from "react";
import {
  fechaVencimientoValida,
  formatearFechaVencimiento,
} from "@/app/(app)/compras/_lib/vencimiento";

// Se abre al elegir el motivo "vencido" (pedido del usuario 2026-09-28). Es
// modal y no un campo más del formulario a propósito: obliga a contestar en
// el momento, con el producto en la mano, en vez de dejarlo para el final y
// completarlo de memoria.
//
// Viene precargado con el vencimiento del último lote, si el sistema lo
// sabe. Se puede corregir: en la góndola puede haber mercadería de un lote
// anterior al último que entró.
export function ModalVencimiento({
  producto,
  valorInicial,
  onConfirmar,
  onCancelar,
}: {
  producto: string;
  valorInicial: string;
  onConfirmar: (fecha: string) => void;
  onCancelar: () => void;
}) {
  const [fecha, setFecha] = useState(valorInicial);
  const [error, setError] = useState<string | null>(null);

  function confirmar() {
    if (!fecha.trim()) {
      setError("Escribí la fecha que figura en el envase.");
      return;
    }
    if (!fechaVencimientoValida(fecha)) {
      setError("La fecha va en formato dd/mm/aaaa.");
      return;
    }
    onConfirmar(fecha);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancelar}
    >
      <div
        className="w-[380px] max-w-full rounded-card border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[14px] font-semibold text-text">¿Cuándo vencía?</h2>
        <p className="mt-[2px] text-[12.5px] text-text-3">{producto}</p>

        <input
          autoFocus
          type="text"
          inputMode="numeric"
          placeholder="dd/mm/aaaa"
          maxLength={10}
          className="mt-3 w-full rounded-[8px] border border-border bg-bg px-[12px] py-[9px] text-[16px] tabular-nums text-text outline-none focus:border-moe"
          value={fecha}
          onChange={(e) => {
            setFecha(formatearFechaVencimiento(e.target.value));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmar();
            }
            if (e.key === "Escape") onCancelar();
          }}
        />

        <p className="mt-[5px] text-[11.5px] text-text-3">
          La que figura en el envase. Si ya no se lee, poné la fecha aproximada.
        </p>

        {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="text-[12.5px] text-text-3 hover:text-text"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            className="rounded-[6px] bg-moe px-[14px] py-[8px] text-[13.5px] font-medium text-white hover:bg-moe/90"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
