"use client";

import { useState, useTransition } from "react";
import { guardarRecargoCategoria, eliminarRecargoCategoria } from "../actions";
import { formatoMoneda, formatoFecha } from "../_lib/formato";
import type { Categoria, Sucursal } from "./precios-table";

type Recargo = { sucursal_id: string; categoria_id: string; monto_fijo: number; actualizado_en: string };

function categoriaLabel(categoria: Categoria, categorias: Categoria[]) {
  if (!categoria.categoria_padre_id) return categoria.nombre;
  const padre = categorias.find((c) => c.id === categoria.categoria_padre_id);
  return padre ? `${padre.nombre} · ${categoria.nombre}` : categoria.nombre;
}

function Fila({
  categoria,
  label,
  sucursalId,
  recargoExistente,
  puedeEditar,
}: {
  categoria: Categoria;
  label: string;
  sucursalId: string;
  recargoExistente: Recargo | undefined;
  puedeEditar: boolean;
}) {
  const [monto, setMonto] = useState(recargoExistente ? String(recargoExistente.monto_fijo) : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function guardar() {
    setError(null);
    startTransition(async () => {
      const resultado =
        monto.trim() === ""
          ? await eliminarRecargoCategoria(sucursalId, categoria.id)
          : await guardarRecargoCategoria(sucursalId, categoria.id, Number(monto));
      if ("error" in resultado) setError(resultado.error);
    });
  }

  return (
    <tr className="border-b border-[#F1F1F3] last:border-b-0">
      <td className="px-[14px] py-[7px] align-middle text-text">{label}</td>
      <td className="px-[14px] py-[7px] align-middle text-right tabular-nums text-text-3">
        {recargoExistente ? formatoFecha.format(new Date(recargoExistente.actualizado_en)) : "—"}
      </td>
      <td className="px-[14px] py-[7px] align-middle text-right">
        {puedeEditar ? (
          <div className="flex items-center justify-end gap-2">
            <input
              type="number"
              min={0}
              step="1"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="Sin recargo"
              className="w-[110px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] text-text outline-none focus:border-moe"
            />
            <button
              type="button"
              onClick={guardar}
              disabled={pending}
              className="text-[12px] font-medium text-moe hover:underline disabled:opacity-60"
            >
              {pending ? "…" : "Guardar"}
            </button>
          </div>
        ) : (
          <span className="tabular-nums text-text">
            {recargoExistente ? formatoMoneda.format(recargoExistente.monto_fijo) : "—"}
          </span>
        )}
        {error && <p className="mt-1 text-[11px] text-err">{error}</p>}
      </td>
    </tr>
  );
}

export function RecargosCategoriaPanel({
  sucursalLaprida,
  categorias,
  recargos,
  puedeEditar,
}: {
  sucursalLaprida: Sucursal;
  categorias: Categoria[];
  recargos: Recargo[];
  puedeEditar: boolean;
}) {
  const categoriasOrdenadas = [...categorias].sort((a, b) =>
    categoriaLabel(a, categorias).localeCompare(categoriaLabel(b, categorias), "es"),
  );

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Recargo por categoría — {sucursalLaprida.nombre}</h2>
        <p className="mt-[2px] text-[11.5px] text-text-3">
          Monto fijo por unidad contenida, se suma al precio de Olavarría. Los SKU de cascada de cerveza
          en lata no usan este mecanismo.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                Categoría
              </th>
              <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                Última actualización
              </th>
              <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                Recargo
              </th>
            </tr>
          </thead>
          <tbody>
            {categoriasOrdenadas.map((categoria) => (
              <Fila
                key={categoria.id}
                categoria={categoria}
                label={categoriaLabel(categoria, categorias)}
                sucursalId={sucursalLaprida.id}
                recargoExistente={recargos.find(
                  (r) => r.sucursal_id === sucursalLaprida.id && r.categoria_id === categoria.id,
                )}
                puedeEditar={puedeEditar}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
