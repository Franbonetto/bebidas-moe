"use client";

import Link from "next/link";
import { formatoFechaHora } from "../../compras/_lib/formato";
import {
  EstadoInventarioBadge,
  TIPO_INVENTARIO_LABEL,
  type EstadoInventario,
  type TipoInventario,
} from "./estado-inventario-badge";

export type InventarioRow = {
  id: string;
  tipo: TipoInventario;
  estado: EstadoInventario;
  fecha_inicio: string;
  fecha_fin: string | null;
  sucursal: { nombre: string } | null;
  categoria: { nombre: string } | null;
  inventario_items: { diferencia: number | null }[];
};

export function InventariosTable({
  inventarios,
  puedeCrear,
}: {
  inventarios: InventarioRow[];
  puedeCrear: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Inventarios</h2>
        {puedeCrear && (
          <Link
            href="/inventarios/nuevo"
            className="whitespace-nowrap rounded-[6px] bg-moe px-[12px] py-[6px] text-[13px] font-medium text-white hover:bg-moe/90"
          >
            Nuevo inventario
          </Link>
        )}
      </div>

      {inventarios.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          <p className="mb-[3px] text-[13.5px] font-semibold text-text">Todavía no hay inventarios</p>
          <p className="text-[12.5px] text-text-3">
            Los conteos físicos que hagas van a aparecer acá.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Sucursal
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Modalidad
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Estado
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Iniciado
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  Productos
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  Con diferencia
                </th>
              </tr>
            </thead>
            <tbody>
              {inventarios.map((inv) => {
                const total = inv.inventario_items.length;
                const conDiferencia = inv.inventario_items.filter(
                  (i) => (i.diferencia ?? 0) !== 0,
                ).length;
                const modalidad =
                  inv.tipo === "categoria" && inv.categoria
                    ? `${TIPO_INVENTARIO_LABEL[inv.tipo]} · ${inv.categoria.nombre}`
                    : TIPO_INVENTARIO_LABEL[inv.tipo];
                return (
                  <tr key={inv.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
                    <td className="px-0 py-0">
                      <Link
                        href={`/inventarios/${inv.id}`}
                        className="block px-[14px] py-[9px] font-medium text-text"
                      >
                        {inv.sucursal?.nombre ?? "—"}
                      </Link>
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text-2">{modalidad}</td>
                    <td className="px-[14px] py-[9px] align-middle">
                      <EstadoInventarioBadge estado={inv.estado} />
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text-2">
                      {formatoFechaHora.format(new Date(inv.fecha_inicio))}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {total}
                    </td>
                    <td
                      className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
                        conDiferencia > 0 ? "font-medium text-warn" : "text-text-2"
                      }`}
                    >
                      {conDiferencia}
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
