"use client";

import { useState, useTransition } from "react";
import { cerrarPedidoManual } from "../actions";

export function CierreManualForm({
  pedidoId,
  onClose,
}: {
  pedidoId: string;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    if (!motivo.trim()) {
      setError("El motivo es obligatorio para cerrar un pedido con mercadería sin despachar.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const resultado = await cerrarPedidoManual(pedidoId, motivo.trim());
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-[460px] rounded-card border border-border bg-bg p-5">
        <h2 className="mb-1 text-[14px] font-semibold text-text">Cerrar pedido manualmente</h2>
        <p className="mb-4 text-[12.5px] text-text-3">
          Lo que quedó preparado y nunca se despachó pasa a pendiente, igual que un faltante. Contá por
          qué se cierra así.
        </p>

        <textarea
          rows={3}
          placeholder="Motivo (obligatorio)"
          className="w-full resize-none rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[13px] text-text outline-none focus:border-moe"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />

        {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {pending ? "Cerrando…" : "Cerrar pedido"}
          </button>
        </div>
      </div>
    </div>
  );
}
