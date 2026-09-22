"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatoMoneda } from "../../vender/_lib/formato";
import { formatoFechaHora } from "@/app/(app)/compras/_lib/formato";

export type EnvioRow = {
  id: string;
  fecha: string;
  total: number;
  sucursalNombre: string;
  motomandado: string;
  direccionEnvio: string;
  medioPagoLabel: string;
};

// Panel del dueño: solo lectura (no arma envíos, no opera el mostrador),
// pero necesita ver qué se despachó, a dónde y con quién -- ver
// 20260921100000_envios.sql.
export function EnviosHistorialTable({ envios }: { envios: EnvioRow[] }) {
  const [query, setQuery] = useState("");

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return envios;
    return envios.filter(
      (e) =>
        e.motomandado.toLowerCase().includes(q) ||
        e.direccionEnvio.toLowerCase().includes(q) ||
        e.sucursalNombre.toLowerCase().includes(q),
    );
  }, [envios, query]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Envíos — últimos 60 días</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por motomandado, dirección o sucursal…"
          className="w-[280px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
        />
      </div>

      {filtrados.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          <p className="mb-[3px] text-[13.5px] font-semibold text-text">
            {envios.length === 0 ? "Todavía no hay envíos registrados" : "No encontramos envíos"}
          </p>
          <p className="text-[12.5px] text-text-3">
            {envios.length === 0
              ? "Van a aparecer acá apenas se cargue el primero desde Envíos, en Olavarría o Laprida."
              : "Probá con otro motomandado, dirección o sucursal."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Fecha
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Sucursal
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Motomandado
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Dirección
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Medio de pago
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Total
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px]" />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => (
                <tr key={e.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
                  <td className="px-[14px] py-[9px] align-middle text-text-2">
                    {formatoFechaHora.format(new Date(e.fecha))}
                  </td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">{e.sucursalNombre}</td>
                  <td className="px-[14px] py-[9px] align-middle font-medium text-text">{e.motomandado}</td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">{e.direccionEnvio}</td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">{e.medioPagoLabel}</td>
                  <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
                    {formatoMoneda.format(e.total)}
                  </td>
                  <td className="px-[14px] py-[9px] text-right align-middle">
                    <Link
                      href={`/ticket/${e.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px] font-medium text-moe hover:underline"
                    >
                      Ver ticket
                    </Link>
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
