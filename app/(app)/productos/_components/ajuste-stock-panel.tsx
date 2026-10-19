"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { ajustarStockSku } from "../actions";

export type StockPorSucursal = {
  sucursalId: string;
  sucursalNombre: string;
  cantidad: number;
};

// Ajustar el stock de este SKU sin abrir un inventario (pedido del usuario
// 2026-10-19: "en productos agregar poder ajustar stock desde el boton
// editar"). Se escribe el stock REAL que se contó y el sistema genera el
// movimiento de ajuste por la diferencia -- mismo criterio que un
// inventario, donde se carga lo contado y no la diferencia.
//
// El motivo es obligatorio y el PIN se pide antes de confirmar.
export function AjusteStockPanel({
  skuId,
  skuNombre,
  stock,
}: {
  skuId: string;
  skuNombre: string;
  stock: StockPorSucursal[];
}) {
  const router = useRouter();
  const pedirPin = usePinOperaciones();

  const [sucursalId, setSucursalId] = useState(stock[0]?.sucursalId ?? "");
  const [contado, setContado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const elegida = stock.find((s) => s.sucursalId === sucursalId);
  const contadoNum = contado.trim() === "" ? null : Number(contado);
  const diferencia =
    elegida && contadoNum !== null && Number.isFinite(contadoNum)
      ? contadoNum - elegida.cantidad
      : null;

  async function ajustar() {
    setError(null);
    setAviso(null);

    if (!elegida) {
      setError("Elegí la sucursal.");
      return;
    }
    if (contadoNum === null || !Number.isInteger(contadoNum) || contadoNum < 0) {
      setError("Escribí cuántas unidades hay, en número entero.");
      return;
    }
    if (!motivo.trim()) {
      setError("El motivo es obligatorio.");
      return;
    }
    if (diferencia === 0) {
      setError(`El stock del sistema ya es ${elegida.cantidad}: no hay nada que ajustar.`);
      return;
    }

    const pin = await pedirPin();
    if (!pin) return;

    startTransition(async () => {
      const resultado = await ajustarStockSku(skuId, sucursalId, contadoNum, motivo.trim(), pin);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      setAviso(
        `Listo: ${elegida.sucursalNombre} pasó de ${resultado.stockAnterior} a ${resultado.stockPosterior} unidades.`,
      );
      setContado("");
      setMotivo("");
      router.refresh();
    });
  }

  if (stock.length === 0) return null;

  return (
    <div className="mb-4 rounded-card border border-border bg-bg p-4">
      <h2 className="text-[14px] font-semibold text-text">Ajustar stock</h2>
      <p className="mt-[2px] text-[12.5px] text-text-2">
        Para corregir un número que quedó mal. Escribí cuántas unidades hay de verdad y el sistema
        registra el movimiento por la diferencia. Para un conteo completo usá Inventarios.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px]">
        <div>
          <label className="mb-[3px] block text-[12px] font-medium text-text-2">Sucursal</label>
          <select
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[13px] text-text outline-none focus:border-moe"
          >
            {stock.map((s) => (
              <option key={s.sucursalId} value={s.sucursalId}>
                {s.sucursalNombre} — {s.cantidad} en el sistema
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-[3px] block text-[12px] font-medium text-text-2">Hay de verdad</label>
          <input
            type="number"
            min={0}
            step={1}
            value={contado}
            onChange={(e) => setContado(e.target.value)}
            placeholder={elegida ? String(elegida.cantidad) : "0"}
            className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-right text-[13px] tabular-nums text-text outline-none focus:border-moe"
          />
        </div>
      </div>

      <div className="mt-2">
        <label className="mb-[3px] block text-[12px] font-medium text-text-2">
          Motivo — obligatorio
        </label>
        <input
          type="text"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej. se contó mal al cargar, botella roreada, faltante del conteo"
          className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[13px] text-text outline-none focus:border-moe"
        />
      </div>

      {diferencia !== null && diferencia !== 0 && (
        <p
          className={`mt-2 text-[12.5px] font-medium ${diferencia > 0 ? "text-ok" : "text-warn"}`}
        >
          {diferencia > 0
            ? `Va a sumar ${diferencia} unidad${diferencia === 1 ? "" : "es"} a ${skuNombre}.`
            : `Va a restar ${-diferencia} unidad${diferencia === -1 ? "" : "es"} a ${skuNombre}.`}
        </p>
      )}

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}
      {aviso && <p className="mt-2 text-[12.5px] text-ok">{aviso}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={ajustar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Ajustando…" : "Ajustar stock"}
        </button>
      </div>
    </div>
  );
}
