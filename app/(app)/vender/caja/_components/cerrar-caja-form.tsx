"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cerrarCaja } from "../../actions";
import { formatoMoneda } from "../../_lib/formato";

export type EmpleadoOpcion = { id: string; nombre: string };

export function CerrarCajaForm({
  cajaId,
  efectivoEsperado,
  empleados,
}: {
  cajaId: string;
  // Monto de apertura + ventas en efectivo del dia (mismo calculo que hace
  // cerrar_caja() en la base) -- se llama "esperado" y no "sistema" para
  // no confundirlo con la columna cajas.efectivo_sistema, que recien queda
  // fijada cuando se cierra.
  efectivoEsperado: number;
  // Las de esta sucursal. Puede no ser la misma que abrió: el turno cambia
  // de manos y el cierre lo hace quien está al final del día.
  empleados: EmpleadoOpcion[];
}) {
  const router = useRouter();
  const [declarado, setDeclarado] = useState("");
  const [empleadoId, setEmpleadoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const declaradoNum = Number(declarado);
  const diferencia = declarado.trim() === "" ? null : declaradoNum - efectivoEsperado;

  function confirmar() {
    if (declarado.trim() === "" || Number.isNaN(declaradoNum) || declaradoNum < 0) {
      setError("Ingresá el efectivo contado en caja.");
      return;
    }
    if (!empleadoId) {
      setError("Elegí quién cierra la caja.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const resultado = await cerrarCaja(cajaId, declaradoNum, empleadoId);
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
        ¿Quién cierra la caja?
      </label>
      {empleados.length === 0 ? (
        <p className="mb-3 rounded-[6px] bg-warn-bg px-[10px] py-[7px] text-[12.5px] text-warn">
          No hay personas cargadas en esta sucursal.
        </p>
      ) : (
        <select
          value={empleadoId}
          onChange={(e) => setEmpleadoId(e.target.value)}
          className="mb-3 w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[14px] text-text outline-none focus:border-moe"
        >
          <option value="">Elegí una persona…</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      )}

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
        disabled={pending || empleados.length === 0}
        onClick={confirmar}
        className="mt-3 w-full rounded-[7px] bg-moe px-[11px] py-[10px] text-[13.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
      >
        Cerrar caja
      </button>
    </div>
  );
}
