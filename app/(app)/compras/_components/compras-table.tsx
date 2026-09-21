"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatoFecha, formatoMoneda } from "../_lib/formato";

export type Compra = {
  id: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  estado: "borrador" | "confirmada" | "cerrada";
  total: number;
  proveedor: { razon_social: string; nombre_comercial: string | null } | null;
};

const ESTADO_LABEL: Record<Compra["estado"], string> = {
  borrador: "Borrador",
  confirmada: "Confirmada",
  cerrada: "Cerrada",
};

const ESTADO_CLASS: Record<Compra["estado"], string> = {
  borrador: "bg-bg-2 text-text-2",
  confirmada: "bg-info-bg text-info",
  cerrada: "bg-ok-bg text-ok",
};

export function EstadoCompraBadge({ estado }: { estado: Compra["estado"] }) {
  return (
    <span
      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${ESTADO_CLASS[estado]}`}
    >
      {ESTADO_LABEL[estado]}
    </span>
  );
}

export function ComprasTable({ compras }: { compras: Compra[] }) {
  const [query, setQuery] = useState("");

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return compras;
    return compras.filter((c) => {
      const proveedor = (c.proveedor?.nombre_comercial ?? c.proveedor?.razon_social ?? "").toLowerCase();
      const factura = (c.numero_factura ?? "").toLowerCase();
      return proveedor.includes(q) || factura.includes(q);
    });
  }, [compras, query]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Compras</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por proveedor o factura…"
            className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
          <span className="whitespace-nowrap text-[12px] text-text-3">
            {filtradas.length} de {compras.length}
          </span>
          <Link
            href="/compras/nueva"
            className="whitespace-nowrap rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[13px] font-medium text-text hover:bg-bg-2"
          >
            Nueva compra
          </Link>
          <Link
            href="/compras/directa"
            className="whitespace-nowrap rounded-[6px] bg-moe px-[12px] py-[6px] text-[13px] font-medium text-white hover:bg-moe/90"
          >
            Cargar mercadería
          </Link>
        </div>
      </div>

      {filtradas.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          {compras.length === 0 ? (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                Todavía no hay compras
              </p>
              <p className="text-[12.5px] text-text-3">
                Creá la primera compra para empezar a registrar mercadería de proveedores.
              </p>
            </>
          ) : (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                No encontramos compras
              </p>
              <p className="text-[12.5px] text-text-3">Probá con otro proveedor o número de factura.</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Proveedor
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Factura
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Fecha
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Estado
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
                  <td className="px-0 py-0">
                    <Link href={`/compras/${c.id}`} className="block px-[14px] py-[9px] font-medium text-text">
                      {c.proveedor?.nombre_comercial ?? c.proveedor?.razon_social ?? "—"}
                    </Link>
                  </td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">
                    {c.numero_factura ?? "—"}
                  </td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">
                    {c.fecha_factura ? formatoFecha.format(new Date(c.fecha_factura)) : "—"}
                  </td>
                  <td className="px-[14px] py-[9px] align-middle">
                    <EstadoCompraBadge estado={c.estado} />
                  </td>
                  <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
                    {formatoMoneda.format(c.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
