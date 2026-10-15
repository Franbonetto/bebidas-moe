"use client";

import { useState } from "react";

// Si este botón suma, React se hidrató y los clics de toda la app andan.
// Si el bloque de arriba se llenó pero acá el número no se mueve, el
// problema es el bundle de la app en ese navegador, no el celular.
export function ContadorPrueba() {
  const [toques, setToques] = useState(0);

  return (
    <div className="mt-1 rounded-card border border-border bg-bg p-3">
      <button
        type="button"
        onClick={() => setToques((n) => n + 1)}
        className="rounded-[6px] bg-moe px-[14px] py-[10px] text-[14px] font-medium text-white"
      >
        Tocame
      </button>
      <p className="mt-2 tabular-nums">
        Veces que respondió: <strong>{toques}</strong>
      </p>
      <p className="mt-1 text-[12px] text-text-3">
        Tiene que subir con cada toque. Si queda en 0, los botones del sistema tampoco
        funcionan en este celular.
      </p>
    </div>
  );
}
