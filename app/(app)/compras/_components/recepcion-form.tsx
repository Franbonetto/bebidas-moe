"use client";

import { useState, useTransition } from "react";
import { crearYConfirmarRecepcion, type LineaRecepcion } from "../actions";

export type LineaPendiente = {
  compra_item_id: string;
  sku_id: string;
  nombre: string;
  presentacion: string;
  pendiente: number;
};

export function RecepcionForm({
  compraId,
  lineas,
  onClose,
}: {
  compraId: string;
  lineas: LineaPendiente[];
  onClose: () => void;
}) {
  const [cantidades, setCantidades] = useState<Record<string, number>>(
    Object.fromEntries(lineas.map((l) => [l.compra_item_id, l.pendiente])),
  );
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function faltaMotivo(l: LineaPendiente) {
    const cantidad = cantidades[l.compra_item_id] ?? 0;
    return cantidad !== l.pendiente && !(motivos[l.compra_item_id] ?? "").trim();
  }

  function confirmar() {
    for (const l of lineas) {
      const cantidad = cantidades[l.compra_item_id];
      if (!Number.isInteger(cantidad) || cantidad < 0) {
        setError("Las cantidades recibidas tienen que ser enteros mayores o iguales a cero.");
        return;
      }
      if (faltaMotivo(l)) {
        setError("Hay diferencias sin motivo. Completá el motivo antes de confirmar.");
        return;
      }
    }

    setError(null);
    const payload: LineaRecepcion[] = lineas.map((l) => ({
      compra_item_id: l.compra_item_id,
      sku_id: l.sku_id,
      cantidad_recibida: cantidades[l.compra_item_id],
      motivo_diferencia:
        cantidades[l.compra_item_id] !== l.pendiente ? motivos[l.compra_item_id].trim() : null,
    }));

    startTransition(async () => {
      const resultado = await crearYConfirmarRecepcion(compraId, payload);
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
        <h2 className="mb-1 text-[14px] font-semibold text-text">Nueva recepción</h2>
        <p className="mb-4 text-[12.5px] text-text-3">
          Cargá cuánto llegó de cada línea. Si difiere de lo pendiente, contá el motivo.
        </p>

        <div className="flex flex-col gap-3">
          {lineas.map((l) => {
            const cantidad = cantidades[l.compra_item_id] ?? 0;
            const difiere = cantidad !== l.pendiente;
            return (
              <div key={l.compra_item_id} className="rounded-[6px] border border-border p-[10px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text">{l.nombre}</p>
                    <p className="text-[11.5px] text-text-3">
                      {l.presentacion} · Pendiente: {l.pendiente}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    className="w-[90px] shrink-0 rounded-[6px] border border-border bg-bg px-[8px] py-[5px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                    value={cantidad}
                    onChange={(e) =>
                      setCantidades((prev) => ({
                        ...prev,
                        [l.compra_item_id]: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                {difiere && (
                  <div className="mt-2">
                    <input
                      type="text"
                      placeholder="Motivo de la diferencia (obligatorio)"
                      className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[5px] text-[12.5px] text-text outline-none focus:border-moe"
                      value={motivos[l.compra_item_id] ?? ""}
                      onChange={(e) =>
                        setMotivos((prev) => ({ ...prev, [l.compra_item_id]: e.target.value }))
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
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
            {pending ? "Confirmando…" : "Confirmar recepción"}
          </button>
        </div>
      </div>
    </div>
  );
}
