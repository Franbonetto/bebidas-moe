"use client";

import { useMemo, useState } from "react";
import { presentacionLabel, type SkuPresentacion } from "../../productos/_lib/presentacion";
import type { PrecioVenta } from "@/lib/precios";
import { formatoMoneda } from "../_lib/formato";
import { PrecioSkuForm } from "./precio-sku-form";

export type Sucursal = { id: string; nombre: string; es_central: boolean };
export type Categoria = { id: string; nombre: string; categoria_padre_id: string | null };

export type PrecioSkuRow = {
  id: string;
  nombre: string;
  codigoInterno: string;
  presentacion: SkuPresentacion;
  marcaNombre: string | null;
  categoriaId: string;
  categoriaNombre: string | null;
  precioBaseManual: number | null;
  costoActual: number | null;
  porSucursal: Record<string, PrecioVenta>;
};

const ORIGEN_LABEL: Record<PrecioVenta["origen"], { texto: string; className: string }> = {
  excepcion: { texto: "Excepción", className: "bg-warn-bg text-warn" },
  manual: { texto: "Manual", className: "bg-bg-2 text-text-3" },
  recargo: { texto: "Base + recargo", className: "bg-bg-2 text-text-3" },
  sin_precio: { texto: "Sin precio", className: "bg-bg-2 text-text-3" },
};

function CeldaPrecio({ precio }: { precio: PrecioVenta }) {
  const badge = ORIGEN_LABEL[precio.origen];
  const bajoCosto = precio.bajoCostoEfectivo || precio.bajoCostoOtroMedio;
  const mismoPrecio = precio.precioEfectivo === precio.precioOtroMedio;

  if (precio.precioBase == null) {
    return <span className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${badge.className}`}>{badge.texto}</span>;
  }

  return (
    <div className="flex flex-col items-end gap-[2px]">
      {mismoPrecio ? (
        <span className="tabular-nums text-text">{formatoMoneda.format(precio.precioBase)}</span>
      ) : (
        <>
          <span className="tabular-nums text-text">
            Efectivo {formatoMoneda.format(precio.precioEfectivo ?? 0)}
          </span>
          <span className="tabular-nums text-text-3">
            Otro medio {formatoMoneda.format(precio.precioOtroMedio ?? 0)}
          </span>
        </>
      )}
      <div className="flex items-center gap-[6px]">
        <span className={`inline-block rounded-[4px] px-[6px] py-[1px] text-[10.5px] font-medium ${badge.className}`}>
          {badge.texto}
        </span>
        {bajoCosto && (
          <span
            title="El precio final queda por debajo del costo"
            className="inline-flex items-center rounded-[4px] bg-err-bg px-[6px] py-[1px] text-[10.5px] font-medium text-err"
          >
            ⚠ bajo costo
          </span>
        )}
      </div>
    </div>
  );
}

export function PreciosTable({
  sucursales,
  filas,
  puedeEditar,
  puedeVerCostos,
}: {
  sucursales: Sucursal[];
  filas: PrecioSkuRow[];
  puedeEditar: boolean;
  puedeVerCostos: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("");
  const [filaEnEdicion, setFilaEnEdicion] = useState<PrecioSkuRow | null>(null);

  const categorias = useMemo(() => {
    const nombres = new Set<string>();
    for (const f of filas) {
      if (f.categoriaNombre) nombres.add(f.categoriaNombre);
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
  }, [filas]);

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filas.filter((f) => {
      if (categoria && f.categoriaNombre !== categoria) return false;
      if (!q) return true;
      return (
        f.nombre.toLowerCase().includes(q) ||
        (f.marcaNombre ?? "").toLowerCase().includes(q) ||
        f.codigoInterno.toLowerCase().includes(q)
      );
    });
  }, [filas, query, categoria]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Precios</h2>
        <div className="flex items-center gap-3">
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por producto, marca o código…"
            className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
          <span className="whitespace-nowrap text-[12px] text-text-3">
            {filtradas.length} de {filas.length} SKU
          </span>
        </div>
      </div>

      {filtradas.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          <p className="mb-[3px] text-[13.5px] font-semibold text-text">No encontramos productos</p>
          <p className="text-[12.5px] text-text-3">Probá con otro nombre, marca o código.</p>
        </div>
      ) : (
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Producto
                </th>
                <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Presentación
                </th>
                {puedeVerCostos && (
                  <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                    Costo
                  </th>
                )}
                {sucursales.map((s) => (
                  <th
                    key={s.id}
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2"
                  >
                    {s.nombre}
                  </th>
                ))}
                {puedeEditar && (
                  <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                    &nbsp;
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtradas.map((fila) => (
                <tr key={fila.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
                  <td className="px-[14px] py-[9px] align-middle">
                    <p className="font-medium text-text">{fila.nombre}</p>
                    <p className="text-[11.5px] text-text-3">
                      {[fila.marcaNombre, fila.categoriaNombre].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">
                    {presentacionLabel(fila.presentacion)}
                  </td>
                  {puedeVerCostos && (
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {fila.costoActual != null ? formatoMoneda.format(fila.costoActual) : "—"}
                    </td>
                  )}
                  {sucursales.map((s) => (
                    <td key={s.id} className="px-[14px] py-[9px] text-right align-middle">
                      <CeldaPrecio precio={fila.porSucursal[s.id]} />
                    </td>
                  ))}
                  {puedeEditar && (
                    <td className="px-[14px] py-[9px] text-right align-middle">
                      <button
                        type="button"
                        onClick={() => setFilaEnEdicion(fila)}
                        className="text-[12.5px] font-medium text-moe hover:underline"
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filaEnEdicion && (
        <PrecioSkuForm
          sucursales={sucursales}
          fila={filaEnEdicion}
          onClose={() => setFilaEnEdicion(null)}
        />
      )}
    </div>
  );
}
