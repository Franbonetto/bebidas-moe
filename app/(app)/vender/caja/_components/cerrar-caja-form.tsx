"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cerrarCaja } from "../../actions";
import { formatoMoneda } from "../../_lib/formato";

export function CerrarCajaForm({
  cajaId,
  efectivoSistema,
}: {
  cajaId: string;
  efectivoSistema: number;
}) {
  const router = useRouter();
  const [declarado, setDeclarado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const declaradoNum = Number(declarado);
  const diferencia = declarado.trim() === "" ? null : declaradoNum - efectivoSistema;

  function confirmar() {
    if (declarado.trim() === "" || Number.isNaN(declaradoNum) || declaradoNum < 0) {
      setError("Ingresá el efectivo contado en caja.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const resultado = await cerrarCaja(cajaId, declaradoNum);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-text-2">
        Efectivo contado en caja
      </label>
      <input
        type="number"
        min={0}
        step="1"
        value={declarado}
        onChange={(e) => setDeclarado(e.target.value)}
        className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[14px] tabular-nums outline-none focus:border-moe"
        placeholder="0"
      />

      {diferencia != null && (
        <p
          className={`mt-2 text-[12.5px] ${
            diferencia === 0 ? "text-ok" : diferencia < 0 ? "text-err" : "text-warn"
          }`}
        >
          Diferencia contra el sistema: {formatoMoneda.format(diferencia)}
        </p>
      )}

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={confirmar}
        className="mt-3 w-full rounded-[7px] bg-moe px-[11px] py-[10px] text-[13.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
      >
        Cerrar caja
      </button>
    </div>
  );
}
