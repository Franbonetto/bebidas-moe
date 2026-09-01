"use client";

import { useMemo, useState, useTransition } from "react";
import { guardarRecargoSku, eliminarRecargoSku } from "../actions";
import { formatoMoneda, formatoFecha } from "../_lib/formato";
import { presentacionLabel, type SkuPresentacion } from "../../productos/_lib/presentacion";
import type { Sucursal } from "./precios-table";

type SkuOpcion = { id: string; nombre: string; presentacion: SkuPresentacion };
type Recargo = { sucursal_id: string; sku_id: string; monto_fijo: number; actualizado_en: string };

function FilaExistente({
  sucursalId,
  sku,
  recargo,
  puedeEditar,
}: {
  sucursalId: string;
  sku: SkuOpcion;
  recargo: Recargo;
  puedeEditar: boolean;
}) {
  const [monto, setMonto] = useState(String(recargo.monto_fijo));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function guardar() {
    setError(null);
    startTransition(async () => {
      const resultado = await guardarRecargoSku(sucursalId, sku.id, Number(monto));
      if ("error" in resultado) setError(resultado.error);
    });
  }

  function quitar() {
    setError(null);
    startTransition(async () => {
      const resultado = await eliminarRecargoSku(sucursalId, sku.id);
      if ("error" in resultado) setError(resultado.error);
    });
  }

  return (
    <tr className="border-b border-[#F1F1F3] last:border-b-0">
      <td className="px-[14px] py-[7px] align-middle text-text">
        {sku.nombre} <span className="text-text-3">· {presentacionLabel(sku.presentacion)}</span>
      </td>
      <td className="px-[14px] py-[7px] align-middle text-right tabular-nums text-text-3">
        {formatoFecha.format(new Date(recargo.actualizado_en))}
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
              className="w-[100px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] text-text outline-none focus:border-moe"
            />
            <button
              type="button"
              onClick={guardar}
              disabled={pending}
              className="text-[12px] font-medium text-moe hover:underline disabled:opacity-60"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={quitar}
              disabled={pending}
              className="text-[12px] font-medium text-text-3 hover:text-err hover:underline disabled:opacity-60"
            >
              Quitar
            </button>
          </div>
        ) : (
          <span className="tabular-nums text-text">{formatoMoneda.format(recargo.monto_fijo)}</span>
        )}
        {error && <p className="mt-1 text-[11px] text-err">{error}</p>}
      </td>
    </tr>
  );
}

function FormularioNuevaExcepcion({
  sucursalId,
  skusDisponibles,
}: {
  sucursalId: string;
  skusDisponibles: SkuOpcion[];
}) {
  const [skuId, setSkuId] = useState("");
  const [monto, setMonto] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function agregar() {
    if (!skuId) {
      setError("Elegí un SKU.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const resultado = await guardarRecargoSku(sucursalId, skuId, Number(monto || 0));
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      setSkuId("");
      setMonto("");
    });
  }

  if (skusDisponibles.length === 0) return null;

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border bg-bg-2 px-[14px] py-[10px]">
      <div className="min-w-[220px] flex-1">
        <label className="mb-[4px] block text-[11.5px] font-medium text-text-2">SKU</label>
        <select
          value={skuId}
          onChange={(e) => setSkuId(e.target.value)}
          className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
        >
          <option value="">Elegir SKU…</option>
          {skusDisponibles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre} · {presentacionLabel(s.presentacion)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-[4px] block text-[11.5px] font-medium text-text-2">Monto fijo</label>
        <input
          type="number"
          min={0}
          step="1"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className="w-[110px] rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
        />
      </div>
      <button
        type="button"
        onClick={agregar}
        disabled={pending}
        className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
      >
        {pending ? "Agregando…" : "Agregar excepción"}
      </button>
      {error && <p className="w-full text-[11.5px] text-err">{error}</p>}
    </div>
  );
}

export function RecargosSkuPanel({
  sucursalLaprida,
  skus,
  recargos,
  puedeEditar,
}: {
  sucursalLaprida: Sucursal;
  skus: SkuOpcion[];
  recargos: Recargo[];
  puedeEditar: boolean;
}) {
  const recargosDeLaSucursal = recargos.filter((r) => r.sucursal_id === sucursalLaprida.id);
  const skuPorId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const skusDisponibles = skus.filter((s) => !recargosDeLaSucursal.some((r) => r.sku_id === s.id));

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">
          Excepciones de recargo por SKU — {sucursalLaprida.nombre}
        </h2>
        <p className="mt-[2px] text-[11.5px] text-text-3">
          Un SKU con excepción acá ignora el recargo de su categoría (ej. Absolut, La Scala).
        </p>
      </div>
      {recargosDeLaSucursal.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  SKU
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
              {recargosDeLaSucursal.map((r) => {
                const sku = skuPorId.get(r.sku_id);
                if (!sku) return null;
                return (
                  <FilaExistente
                    key={r.sku_id}
                    sucursalId={sucursalLaprida.id}
                    sku={sku}
                    recargo={r}
                    puedeEditar={puedeEditar}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {recargosDeLaSucursal.length === 0 && (
        <div className="px-[14px] py-[16px] text-[12.5px] text-text-3">Todavía no hay excepciones cargadas.</div>
      )}
      {puedeEditar && (
        <FormularioNuevaExcepcion sucursalId={sucursalLaprida.id} skusDisponibles={skusDisponibles} />
      )}
    </div>
  );
}
