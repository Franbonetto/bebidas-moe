"use client";

import { useState, useTransition } from "react";
import { guardarDescuentoEfectivo, eliminarDescuentoEfectivo } from "../actions";
import { formatoFecha } from "../_lib/formato";
import type { Categoria, Sucursal } from "./precios-table";

type Descuento = { sucursal_id: string; categoria_id: string; porcentaje: number; actualizado_en: string };

function Fila({
  categoria,
  sucursalId,
  descuentoExistente,
  puedeEditar,
}: {
  categoria: Categoria;
  sucursalId: string;
  descuentoExistente: Descuento | undefined;
  puedeEditar: boolean;
}) {
  const [porcentaje, setPorcentaje] = useState(
    descuentoExistente ? String(descuentoExistente.porcentaje) : "",
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function guardar() {
    setError(null);
    startTransition(async () => {
      const resultado =
        porcentaje.trim() === ""
          ? await eliminarDescuentoEfectivo(sucursalId, categoria.id)
          : await guardarDescuentoEfectivo(sucursalId, categoria.id, Number(porcentaje));
      if ("error" in resultado) setError(resultado.error);
    });
  }

  return (
    <tr className="border-b border-[#F1F1F3] last:border-b-0">
      <td className="px-[14px] py-[7px] align-middle text-text">{categoria.nombre}</td>
      <td className="px-[14px] py-[7px] align-middle text-right tabular-nums text-text-3">
        {descuentoExistente ? formatoFecha.format(new Date(descuentoExistente.actualizado_en)) : "—"}
      </td>
      <td className="px-[14px] py-[7px] align-middle text-right">
        {puedeEditar ? (
          <div className="flex items-center justify-end gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step="1"
              value={porcentaje}
              onChange={(e) => setPorcentaje(e.target.value)}
              placeholder="Sin descuento"
              className="w-[90px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] text-text outline-none focus:border-moe"
            />
            <span className="text-[12px] text-text-3">%</span>
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
            {descuentoExistente ? `${descuentoExistente.porcentaje}%` : "—"}
          </span>
        )}
        {error && <p className="mt-1 text-[11px] text-err">{error}</p>}
      </td>
    </tr>
  );
}

export function DescuentosEfectivoPanel({
  sucursalCentral,
  categorias,
  descuentos,
  puedeEditar,
}: {
  sucursalCentral: Sucursal;
  categorias: Categoria[];
  descuentos: Descuento[];
  puedeEditar: boolean;
}) {
  const categoriasOrdenadas = [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Descuento por efectivo — {sucursalCentral.nombre}</h2>
        <p className="mt-[2px] text-[11.5px] text-text-3">
          Billete en mano, no débito/crédito/transferencia. Distinto de las promociones (combo, 2x,
          promocional): son dos mecanismos separados que pueden coexistir.
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
                Descuento
              </th>
            </tr>
          </thead>
          <tbody>
            {categoriasOrdenadas.map((categoria) => (
              <Fila
                key={categoria.id}
                categoria={categoria}
                sucursalId={sucursalCentral.id}
                descuentoExistente={descuentos.find(
                  (d) => d.sucursal_id === sucursalCentral.id && d.categoria_id === categoria.id,
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
