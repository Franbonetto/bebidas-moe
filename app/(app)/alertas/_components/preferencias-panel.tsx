"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarPreferenciaAlerta } from "../actions";

export type CategoriaAlerta =
  | "stock"
  | "pedidos_transferencias"
  | "ventas_sin_stock"
  | "costos"
  | "inmovilizado"
  | "rentabilidad"
  | "envases";

export function PreferenciasPanel({
  categorias,
  preferencias,
}: {
  categorias: { id: CategoriaAlerta; label: string }[];
  preferencias: Partial<Record<CategoriaAlerta, boolean>>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(categoria: CategoriaAlerta, visibleActual: boolean) {
    setError(null);
    startTransition(async () => {
      const resultado = await guardarPreferenciaAlerta(categoria, !visibleActual);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="rounded-[6px] border border-border bg-bg px-[10px] py-[5px] text-[12.5px] font-medium text-text-2 hover:bg-bg-2"
      >
        Personalizar qué ver
      </button>

      {abierto && (
        <div className="absolute right-0 z-10 mt-1 w-[260px] rounded-card border border-border bg-bg p-3 shadow-sm">
          <p className="mb-2 text-[11.5px] text-text-3">
            Ocultar una categoría solo afecta tu vista — sigue calculándose igual para los demás.
          </p>
          <div className="flex flex-col gap-[6px]">
            {categorias.map((c) => {
              const visible = preferencias[c.id] !== false;
              return (
                <label key={c.id} className="flex items-center gap-2 text-[13px] text-text">
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={pending}
                    onChange={() => toggle(c.id, visible)}
                  />
                  {c.label}
                </label>
              );
            })}
          </div>
          {error && <p className="mt-2 text-[11.5px] text-err">{error}</p>}
        </div>
      )}
    </div>
  );
}
