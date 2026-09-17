"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { abrirCaja } from "../actions";

export function AbrirCajaForm({ sucursalId, sucursalNombre }: { sucursalId: string; sucursalNombre: string }) {
  const router = useRouter();
  const [monto, setMonto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function abrir() {
    const montoNum = Number(monto);
    if (monto.trim() === "" || Number.isNaN(montoNum) || montoNum < 0) {
      setError("Contá el efectivo que hay en la caja y cargá ese monto.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const resultado = await abrirCaja(sucursalId, montoNum);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-[420px] rounded-card border border-border bg-bg p-6">
      <h1 className="mb-1 text-[15px] font-semibold text-text">Abrir caja — {sucursalNombre}</h1>
      <p className="mb-4 text-[12.5px] text-text-3">
        Contá el efectivo que hay hoy en la caja antes de empezar a vender.
      </p>

      <label className="mb-1 block text-[12px] font-medium text-text-2">Monto de apertura</label>
      <input
        type="number"
        min={0}
        step="1"
        autoFocus
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[14px] tabular-nums outline-none focus:border-moe"
        placeholder="0"
      />

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={abrir}
        className="mt-4 w-full rounded-[7px] bg-moe px-[11px] py-[10px] text-[13.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
      >
        {pending ? "Abriendo…" : "Abrir caja y empezar a vender"}
      </button>
    </div>
  );
}
