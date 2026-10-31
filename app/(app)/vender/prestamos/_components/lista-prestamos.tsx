"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { reintegrarPrestamo } from "../actions";
import { formatoFecha, formatoFechaHora } from "../_lib/formato";

export type ItemPrestamoVista = {
  skuId: string;
  skuNombre: string;
  cantidadPrestada: number;
  cantidadDevuelta: number;
};

export type PrestamoActivo = {
  id: string;
  proveedorNombre: string;
  usuarioNombre: string;
  fechaPrestamo: string;
  fechaEstimadaDevolucion: string | null;
  atrasado: boolean;
  nota: string | null;
  items: ItemPrestamoVista[];
};

export type PrestamoHistorial = {
  id: string;
  proveedorNombre: string;
  usuarioNombre: string;
  usuarioDevolucionNombre: string | null;
  fechaPrestamo: string;
  fechaDevolucion: string | null;
  nota: string | null;
  items: { skuNombre: string; cantidadPrestada: number }[];
};

function PrestamoActivoCard({ prestamo }: { prestamo: PrestamoActivo }) {
  const router = useRouter();
  const pedirPin = usePinOperaciones();

  const pendientes = new Map(
    prestamo.items.map((i) => [i.skuId, i.cantidadPrestada - i.cantidadDevuelta]),
  );

  const [cantidades, setCantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries(prestamo.items.map((i) => [i.skuId, pendientes.get(i.skuId) ?? 0])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function reintegrar() {
    setError(null);

    const items = prestamo.items
      .map((i) => ({ skuId: i.skuId, cantidad: cantidades[i.skuId] ?? 0 }))
      .filter((i) => i.cantidad > 0);

    if (items.length === 0) {
      setError("Marcá al menos una cantidad mayor a cero.");
      return;
    }

    for (const i of items) {
      const pendiente = pendientes.get(i.skuId) ?? 0;
      if (!Number.isInteger(i.cantidad) || i.cantidad > pendiente) {
        setError(`No podés reintegrar más de lo pendiente (quedan ${pendiente}).`);
        return;
      }
    }

    const pin = await pedirPin();
    if (!pin) return;

    startTransition(async () => {
      const resultado = await reintegrarPrestamo(prestamo.id, items, pin);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-card border border-border bg-bg p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13.5px] font-semibold text-text">{prestamo.proveedorNombre}</p>
          <p className="text-[12px] text-text-3">
            Prestado el {formatoFechaHora.format(new Date(prestamo.fechaPrestamo))} por{" "}
            {prestamo.usuarioNombre}
          </p>
        </div>
        {prestamo.fechaEstimadaDevolucion && (
          <span
            className={`shrink-0 rounded-[6px] px-[8px] py-[3px] text-[12px] font-medium ${
              prestamo.atrasado ? "bg-warn-bg text-warn" : "bg-bg-2 text-text-2"
            }`}
          >
            {prestamo.atrasado ? "Atrasado" : "Vuelve"} ·{" "}
            {formatoFecha.format(new Date(`${prestamo.fechaEstimadaDevolucion}T00:00:00`))}
          </span>
        )}
      </div>

      {prestamo.nota && (
        <p className="mt-2 text-[12.5px] text-text-2">&ldquo;{prestamo.nota}&rdquo;</p>
      )}

      <div className="mt-3 overflow-hidden rounded-[6px] border border-border">
        <div className="grid grid-cols-[1fr_70px_70px_90px] gap-2 bg-bg-2 px-[10px] py-[6px] text-[11.5px] font-medium text-text-3">
          <span>Producto</span>
          <span className="text-right">Prestado</span>
          <span className="text-right">Pendiente</span>
          <span className="text-right">Reintegra</span>
        </div>
        {prestamo.items.map((item) => {
          const pendiente = pendientes.get(item.skuId) ?? 0;
          return (
            <div
              key={item.skuId}
              className="grid grid-cols-[1fr_70px_70px_90px] items-center gap-2 border-t border-[#F1F1F3] px-[10px] py-[6px] text-[13px]"
            >
              <span className="text-text">{item.skuNombre}</span>
              <span className="text-right tabular-nums text-text-2">{item.cantidadPrestada}</span>
              <span className="text-right tabular-nums text-text-2">{pendiente}</span>
              <input
                type="number"
                min={0}
                max={pendiente}
                step={1}
                value={cantidades[item.skuId] ?? 0}
                onChange={(e) =>
                  setCantidades((c) => ({
                    ...c,
                    [item.skuId]: Math.max(0, Math.min(pendiente, Number(e.target.value))),
                  }))
                }
                className="w-full rounded-[6px] border border-border bg-bg px-[6px] py-[3px] text-right text-[13px] tabular-nums text-text outline-none focus:border-moe"
              />
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={reintegrar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Reintegrando…" : "Reintegrar mercadería"}
        </button>
      </div>
    </div>
  );
}

export function ListaPrestamos({
  activos,
  historial,
}: {
  activos: PrestamoActivo[];
  historial: PrestamoHistorial[];
}) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold text-text">
        Préstamos activos {activos.length > 0 && `(${activos.length})`}
      </h2>

      {activos.length === 0 ? (
        <p className="mt-2 text-[13px] text-text-2">No hay mercadería prestada pendiente de devolución.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {activos.map((p) => (
            <PrestamoActivoCard key={p.id} prestamo={p} />
          ))}
        </div>
      )}

      {historial.length > 0 && (
        <div className="mt-6">
          <h2 className="text-[14px] font-semibold text-text">Últimos préstamos devueltos</h2>
          <div className="mt-2 overflow-hidden rounded-[6px] border border-border">
            {historial.map((p) => (
              <div
                key={p.id}
                className="border-b border-[#F1F1F3] px-[10px] py-[8px] text-[13px] last:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text">{p.proveedorNombre}</span>
                  <span className="text-[12px] text-text-3">
                    {p.fechaDevolucion && formatoFecha.format(new Date(p.fechaDevolucion))}
                  </span>
                </div>
                <p className="mt-[2px] text-[12.5px] text-text-2">
                  {p.items.map((i) => `${i.cantidadPrestada} ${i.skuNombre}`).join(", ")}
                </p>
                <p className="mt-[2px] text-[11.5px] text-text-3">
                  Prestó {p.usuarioNombre}
                  {p.usuarioDevolucionNombre && ` · Reintegró ${p.usuarioDevolucionNombre}`}
                  {p.nota && ` · "${p.nota}"`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
