"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { liquidarConsignacionSinVenta } from "../actions";
import { formatoFecha, formatoFechaHora } from "../_lib/formato";

export type ItemConsignacionVista = {
  skuId: string;
  skuNombre: string;
  cantidadEntregada: number;
};

export type ConsignacionActiva = {
  id: string;
  clienteNombre: string;
  clienteTelefono: string | null;
  usuarioNombre: string;
  fechaEntrega: string;
  fechaEstimadaDevolucion: string | null;
  atrasado: boolean;
  nota: string | null;
  items: ItemConsignacionVista[];
};

export type ConsignacionHistorial = {
  id: string;
  clienteNombre: string;
  usuarioNombre: string;
  usuarioLiquidacionNombre: string | null;
  fechaEntrega: string;
  fechaLiquidacion: string | null;
  ventaId: string | null;
  nota: string | null;
  items: { skuNombre: string; cantidadEntregada: number }[];
};

function ConsignacionActivaCard({ consignacion }: { consignacion: ConsignacionActiva }) {
  const router = useRouter();
  const pedirPin = usePinOperaciones();

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function devolverTodo() {
    setError(null);

    const pin = await pedirPin();
    if (!pin) return;

    startTransition(async () => {
      const resultado = await liquidarConsignacionSinVenta(consignacion.id, pin);
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
          <p className="text-[13.5px] font-semibold text-text">
            {consignacion.clienteNombre}
            {consignacion.clienteTelefono && (
              <span className="ml-2 font-normal text-text-3">{consignacion.clienteTelefono}</span>
            )}
          </p>
          <p className="text-[12px] text-text-3">
            Entregado el {formatoFechaHora.format(new Date(consignacion.fechaEntrega))} por{" "}
            {consignacion.usuarioNombre}
          </p>
        </div>
        {consignacion.fechaEstimadaDevolucion && (
          <span
            className={`shrink-0 rounded-[6px] px-[8px] py-[3px] text-[12px] font-medium ${
              consignacion.atrasado ? "bg-warn-bg text-warn" : "bg-bg-2 text-text-2"
            }`}
          >
            {consignacion.atrasado ? "Atrasada" : "Vuelve"} ·{" "}
            {formatoFecha.format(new Date(`${consignacion.fechaEstimadaDevolucion}T00:00:00`))}
          </span>
        )}
      </div>

      {consignacion.nota && (
        <p className="mt-2 text-[12.5px] text-text-2">&ldquo;{consignacion.nota}&rdquo;</p>
      )}

      <div className="mt-3 overflow-hidden rounded-[6px] border border-border">
        <div className="grid grid-cols-[1fr_90px] gap-2 bg-bg-2 px-[10px] py-[6px] text-[11.5px] font-medium text-text-3">
          <span>Producto</span>
          <span className="text-right">Entregado</span>
        </div>
        {consignacion.items.map((item) => (
          <div
            key={item.skuId}
            className="grid grid-cols-[1fr_90px] items-center gap-2 border-t border-[#F1F1F3] px-[10px] py-[6px] text-[13px]"
          >
            <span className="text-text">{item.skuNombre}</span>
            <span className="text-right tabular-nums text-text-2">{item.cantidadEntregada}</span>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={devolverTodo}
          disabled={pending}
          className="rounded-[6px] border border-border px-[12px] py-[7px] text-[12.5px] font-medium text-text-2 hover:bg-bg-2 disabled:opacity-60"
        >
          No vendió nada, devolver todo
        </button>
        <Link
          href={`/vender?consignacion=${consignacion.id}`}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90"
        >
          Liquidar en el POS
        </Link>
      </div>
    </div>
  );
}

export function ListaConsignaciones({
  activas,
  historial,
}: {
  activas: ConsignacionActiva[];
  historial: ConsignacionHistorial[];
}) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold text-text">
        Consignaciones activas {activas.length > 0 && `(${activas.length})`}
      </h2>

      {activas.length === 0 ? (
        <p className="mt-2 text-[13px] text-text-2">No hay consignaciones pendientes de liquidar.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {activas.map((c) => (
            <ConsignacionActivaCard key={c.id} consignacion={c} />
          ))}
        </div>
      )}

      {historial.length > 0 && (
        <div className="mt-6">
          <h2 className="text-[14px] font-semibold text-text">Últimas consignaciones liquidadas</h2>
          <div className="mt-2 overflow-hidden rounded-[6px] border border-border">
            {historial.map((c) => (
              <div
                key={c.id}
                className="border-b border-[#F1F1F3] px-[10px] py-[8px] text-[13px] last:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text">{c.clienteNombre}</span>
                  <span className="text-[12px] text-text-3">
                    {c.fechaLiquidacion && formatoFecha.format(new Date(c.fechaLiquidacion))}
                  </span>
                </div>
                <p className="mt-[2px] text-[12.5px] text-text-2">
                  {c.items.map((i) => `${i.cantidadEntregada} ${i.skuNombre}`).join(", ")}
                </p>
                <p className="mt-[2px] text-[11.5px] text-text-3">
                  Entregó {c.usuarioNombre}
                  {c.usuarioLiquidacionNombre && ` · Liquidó ${c.usuarioLiquidacionNombre}`}
                  {!c.ventaId && " · No se vendió nada"}
                  {c.nota && ` · "${c.nota}"`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
