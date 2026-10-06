"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { abrirCaja } from "../actions";

export type EmpleadoOpcion = { id: string; nombre: string };

export function AbrirCajaForm({
  sucursalId,
  sucursalNombre,
  empleados,
}: {
  sucursalId: string;
  sucursalNombre: string;
  empleados: EmpleadoOpcion[];
}) {
  const router = useRouter();
  const [monto, setMonto] = useState("");
  // Quién atiende, no con qué cuenta se entró al sistema: es el dato que
  // hace falta cuando al cierre la caja no da.
  const [empleadoId, setEmpleadoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function abrir() {
    const montoNum = Number(monto);
    if (monto.trim() === "" || Number.isNaN(montoNum) || montoNum < 0) {
      setError("Contá el efectivo que hay en la caja y cargá ese monto.");
      return;
    }
    if (!empleadoId) {
      setError("Elegí quién abre la caja.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const resultado = await abrirCaja(sucursalId, montoNum, empleadoId);
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

      <label className="mb-1 block text-[12px] font-medium text-text-2">¿Quién abre la caja?</label>
      {empleados.length === 0 ? (
        <p className="mb-4 rounded-[6px] bg-warn-bg px-[10px] py-[7px] text-[12.5px] text-warn">
          No hay personas cargadas en esta sucursal, así que no se puede abrir la caja. Cargalas
          antes de empezar a vender.
        </p>
      ) : (
        <select
          autoFocus
          value={empleadoId}
          onChange={(e) => setEmpleadoId(e.target.value)}
          className="mb-4 w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[14px] text-text outline-none focus:border-moe"
        >
          <option value="">Elegí una persona…</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      )}

      <label className="mb-1 block text-[12px] font-medium text-text-2">Monto de apertura</label>
      <input
        type="number"
        min={0}
        step="1"
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[14px] tabular-nums outline-none focus:border-moe"
        placeholder="0"
      />

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}

      <button
        type="button"
        disabled={pending || empleados.length === 0}
        onClick={abrir}
        className="mt-4 w-full rounded-[7px] bg-moe px-[11px] py-[10px] text-[13.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
      >
        {pending ? "Abriendo…" : "Abrir caja y empezar a vender"}
      </button>
    </div>
  );
}
