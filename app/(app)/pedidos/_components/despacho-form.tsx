"use client";

import { useState, useTransition } from "react";
import { despacharPedido, type LineaDespacho } from "../actions";

export type LineaPorDespachar = {
  pedido_item_id: string;
  nombre: string;
  presentacion: string;
  disponible: number;
};

export function DespachoForm({
  pedidoId,
  lineas,
  onClose,
}: {
  pedidoId: string;
  lineas: LineaPorDespachar[];
  onClose: () => void;
}) {
  const [cantidades, setCantidades] = useState<Record<string, number>>(
    Object.fromEntries(lineas.map((l) => [l.pedido_item_id, l.disponible])),
  );
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    const aDespachar: LineaDespacho[] = [];
    for (const l of lineas) {
      const cantidad = cantidades[l.pedido_item_id] ?? 0;
      if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > l.disponible) {
        setError(`La cantidad a despachar de "${l.nombre}" tiene que ser un entero entre 0 y ${l.disponible}.`);
        return;
      }
      if (cantidad > 0) aDespachar.push({ pedido_item_id: l.pedido_item_id, cantidad });
    }
    if (aDespachar.length === 0) {
      setError("Cargá al menos una cantidad para despachar.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const resultado = await despacharPedido(pedidoId, aDespachar, observaciones.trim() || null);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-[560px] overflow-y-auto rounded-card border border-border bg-bg p-5">
        <h2 className="mb-1 text-[14px] font-semibold text-text">Despachar</h2>
        <p className="mb-4 text-[12.5px] text-text-3">
          Se descuenta de Olavarría y queda en tránsito hasta que Laprida confirme la recepción. Podés
          despachar menos de lo disponible si es un envío parcial.
        </p>

        <div className="flex flex-col gap-3">
          {lineas.map((l) => (
            <div key={l.pedido_item_id} className="rounded-[6px] border border-border p-[10px]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">{l.nombre}</p>
                  <p className="text-[11.5px] text-text-3">
                    {l.presentacion} · Disponible para despachar: {l.disponible}
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={l.disponible}
                  className="w-[90px] shrink-0 rounded-[6px] border border-border bg-bg px-[8px] py-[5px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                  value={cantidades[l.pedido_item_id] ?? 0}
                  onChange={(e) =>
                    setCantidades((prev) => ({ ...prev, [l.pedido_item_id]: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <input
            type="text"
            placeholder="Observaciones (opcional)"
            className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[5px] text-[12.5px] text-text outline-none focus:border-moe"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
          />
        </div>

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
            {pending ? "Despachando…" : "Despachar"}
          </button>
        </div>
      </div>
    </div>
  );
}
