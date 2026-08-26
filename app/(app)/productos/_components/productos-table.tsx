"use client";

import { useMemo, useState } from "react";
import { presentacionLabel } from "../_lib/presentacion";

export type Sucursal = {
  id: string;
  nombre: string;
  es_central: boolean;
};

export type SkuRow = {
  id: string;
  nombre: string;
  codigo_interno: string;
  tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
  volumen: number;
  unidad_volumen: string;
  unidades_contenidas: number;
  producto: {
    nombre: string;
    marca: { nombre: string } | null;
    categoria: { nombre: string } | null;
  } | null;
  stockPorSucursal: Record<string, number>;
};

// Reexportadas desde un módulo sin "use client" (ver _lib/presentacion.ts):
// este archivo es cliente, y los server components (dashboards) necesitan
// poder llamar a presentacionLabel() sin cruzar ese límite.
export { presentacionLabel } from "../_lib/presentacion";
export type { SkuPresentacion } from "../_lib/presentacion";

// Cero es el estado inicial de un catálogo sin movimientos todavía, no una
// alerta: se muestra en gris neutro. El rojo queda reservado para stock
// negativo (el POS permite vender sin stock, arquitectura.md 1.8).
function stockClassName(cantidad: number) {
  if (cantidad < 0) return "font-medium text-err";
  if (cantidad === 0) return "text-text-3";
  return "text-text";
}

export function ProductosTable({
  sucursales,
  skus,
}: {
  sucursales: Sucursal[];
  skus: SkuRow[];
}) {
  const [query, setQuery] = useState("");

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skus;
    return skus.filter((sku) => {
      const producto = sku.producto?.nombre.toLowerCase() ?? "";
      const marca = sku.producto?.marca?.nombre.toLowerCase() ?? "";
      const codigo = sku.codigo_interno.toLowerCase();
      return producto.includes(q) || marca.includes(q) || codigo.includes(q);
    });
  }, [skus, query]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Catálogo</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por producto, marca o código…"
            className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
          <span className="whitespace-nowrap text-[12px] text-text-3">
            {filtrados.length} de {skus.length} SKU
          </span>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          {skus.length === 0 ? (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                Todavía no hay productos cargados
              </p>
              <p className="text-[12.5px] text-text-3">
                El catálogo aparece acá una vez que se den de alta marcas, productos y SKU.
              </p>
            </>
          ) : (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                No encontramos productos
              </p>
              <p className="text-[12.5px] text-text-3">Probá con otro nombre, marca o código.</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Producto
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Presentación
                </th>
                {sucursales.map((s) => (
                  <th
                    key={s.id}
                    className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2"
                  >
                    Stock {s.nombre}
                  </th>
                ))}
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((sku) => {
                const cantidades = sucursales.map((s) => sku.stockPorSucursal[s.id] ?? 0);
                const total = cantidades.reduce((acc, c) => acc + c, 0);

                return (
                  <tr
                    key={sku.id}
                    className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]"
                  >
                    <td className="px-[14px] py-[9px] align-middle">
                      <p className="font-medium text-text">{sku.producto?.nombre ?? sku.nombre}</p>
                      <p className="text-[11.5px] text-text-3">
                        {[sku.producto?.marca?.nombre, sku.producto?.categoria?.nombre]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text-2">
                      {presentacionLabel(sku)}
                    </td>
                    {cantidades.map((cantidad, i) => (
                      <td
                        key={sucursales[i].id}
                        className={`px-[14px] py-[9px] text-right tabular-nums ${stockClassName(cantidad)}`}
                      >
                        {cantidad}
                      </td>
                    ))}
                    <td
                      className={`px-[14px] py-[9px] text-right font-medium tabular-nums ${stockClassName(total)}`}
                    >
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
