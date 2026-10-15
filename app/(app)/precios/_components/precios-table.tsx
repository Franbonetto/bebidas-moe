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
          <span className="flex items-center gap-[5px]">
            <span className="tabular-nums text-text">
              Efectivo {formatoMoneda.format(precio.precioEfectivo ?? 0)}
            </span>
            {precio.efectivoEsPropio && (
              <span
                title="Monto fijo cargado para este producto: no sale del descuento de la categoría"
                className="inline-block rounded-[4px] bg-warn-bg px-[5px] py-[1px] text-[10px] font-medium text-warn"
              >
                fijo
              </span>
            )}
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
  // Los productos a los que todavía nadie les puso precio. Con más de mil
  // SKU y una fracción con precio cargado, es la forma de que la encargada
  // encuentre lo que falta en vez de scrollear a ciegas.
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const [filaEnEdicion, setFilaEnEdicion] = useState<PrecioSkuRow | null>(null);

  const categorias = useMemo(() => {
    const nombres = new Set<string>();
    for (const f of filas) {
      if (f.categoriaNombre) nombres.add(f.categoriaNombre);
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
  }, [filas]);

  const cantidadSinPrecio = useMemo(
    () => filas.filter((f) => f.precioBaseManual == null).length,
    [filas],
  );

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filas.filter((f) => {
      if (categoria && f.categoriaNombre !== categoria) return false;
      if (soloSinPrecio && f.precioBaseManual != null) return false;
      if (!q) return true;
      return (
        f.nombre.toLowerCase().includes(q) ||
        (f.marcaNombre ?? "").toLowerCase().includes(q) ||
        f.codigoInterno.toLowerCase().includes(q)
      );
    });
  }, [filas, query, categoria, soloSinPrecio]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      {/* En celular la barra se apila y el buscador va a todo el ancho; en
          desktop queda la fila de siempre. El contador se muestra al lado
          del título, que es donde queda lugar en una pantalla angosta. */}
      <div className="flex flex-col gap-2 border-b border-border px-[14px] py-[11px] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-text">Precios</h2>
          <span className="whitespace-nowrap text-[12px] text-text-3 sm:hidden">
            {filtradas.length} de {filas.length}
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por producto, marca o código…"
            className="w-full rounded-[6px] border border-border bg-bg-2 px-[10px] py-[8px] text-[16px] text-text outline-none focus:border-moe sm:w-[240px] sm:py-[5px] sm:text-[13px]"
          />

          <div className="flex items-center gap-2">
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="min-w-0 flex-1 rounded-[6px] border border-border bg-bg-2 px-[10px] py-[8px] text-[16px] text-text outline-none focus:border-moe sm:flex-none sm:py-[5px] sm:text-[13px]"
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setSoloSinPrecio((v) => !v)}
              title="Mostrar solo los productos que todavía no tienen precio cargado"
              className={`shrink-0 whitespace-nowrap rounded-[6px] border px-[10px] py-[8px] text-[13px] font-medium sm:py-[5px] sm:text-[12.5px] ${
                soloSinPrecio
                  ? "border-moe bg-moe-soft text-moe"
                  : "border-border bg-bg-2 text-text-2 hover:bg-bg"
              }`}
            >
              Sin precio{cantidadSinPrecio > 0 && ` · ${cantidadSinPrecio}`}
            </button>
          </div>

          <span className="hidden whitespace-nowrap text-[12px] text-text-3 sm:inline">
            {filtradas.length} de {filas.length} SKU
          </span>
        </div>
      </div>

      {filtradas.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          {soloSinPrecio ? (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                No quedan productos sin precio
              </p>
              <p className="text-[12.5px] text-text-3">
                {categoria || query
                  ? "Con los filtros puestos, todos tienen precio cargado."
                  : "Todo el catálogo tiene precio de venta."}
              </p>
            </>
          ) : (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">No encontramos productos</p>
              <p className="text-[12.5px] text-text-3">Probá con otro nombre, marca o código.</p>
            </>
          )}
        </div>
      ) : (
        <>
        {/* Celular: una tarjeta por producto, tocable para editar. La tabla
            de cinco columnas no entra en un teléfono, y comprimirla la
            vuelve ilegible (identidad-visual.md: las tablas se adaptan, no
            se comprimen). */}
        <div className="flex flex-col divide-y divide-[#F1F1F3] md:hidden">
          {filtradas.map((fila) => {
            const contenido = (
              <>
                <p className="text-[15px] font-medium leading-tight text-text">{fila.nombre}</p>
                <p className="mt-[2px] text-[12.5px] text-text-3">
                  {[fila.marcaNombre, presentacionLabel(fila.presentacion)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                <div className="mt-[8px] flex flex-col gap-[5px]">
                  {sucursales.map((s) => (
                    <div key={s.id} className="flex items-start justify-between gap-3">
                      <span className="pt-[1px] text-[13px] text-text-2">{s.nombre}</span>
                      <CeldaPrecio precio={fila.porSucursal[s.id]} />
                    </div>
                  ))}
                  {puedeVerCostos && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-text-3">Costo</span>
                      <span className="text-[13px] tabular-nums text-text-3">
                        {fila.costoActual != null ? formatoMoneda.format(fila.costoActual) : "—"}
                      </span>
                    </div>
                  )}
                </div>
              </>
            );

            return puedeEditar ? (
              <button
                key={fila.id}
                type="button"
                onClick={() => setFilaEnEdicion(fila)}
                className="w-full px-[14px] py-[11px] text-left active:bg-bg-2"
              >
                {contenido}
                <span className="mt-[8px] inline-block text-[13px] font-medium text-moe">
                  Editar precio →
                </span>
              </button>
            ) : (
              <div key={fila.id} className="px-[14px] py-[11px]">
                {contenido}
              </div>
            );
          })}
        </div>

        <div className="hidden max-h-[65vh] overflow-auto md:block">
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
        </>
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
