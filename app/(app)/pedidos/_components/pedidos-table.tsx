"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { formatoFecha } from "../../compras/_lib/formato";
import { EstadoPedidoBadge, type EstadoPedido } from "./estado-pedido-badge";

export type PedidoRow = {
  id: string;
  numero: string;
  estado: EstadoPedido;
  fecha_creacion: string;
  fecha_envio: string | null;
  pedido_items: { cantidad_solicitada: number }[];
};

type Grupo = "en_curso" | "enviados" | "recibidos";

const GRUPO_LABEL: Record<Grupo, string> = {
  en_curso: "En curso",
  enviados: "Enviados (en tránsito)",
  recibidos: "Recibidos",
};

function grupoDe(estado: EstadoPedido): Grupo {
  if (estado === "cerrado") return "recibidos";
  if (estado === "despachado") return "enviados";
  return "en_curso";
}

export function PedidosTable({
  pedidos,
  puedeCrear,
  agruparPorRecepcion = false,
}: {
  pedidos: PedidoRow[];
  puedeCrear: boolean;
  // Solo tiene sentido del lado de Laprida: distinguir lo que ya le llegó
  // (recibidos) de lo que salió de Olavarría y todavía está en camino
  // (enviados), además de lo que sigue en preparación.
  agruparPorRecepcion?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pedidos;
    return pedidos.filter((p) => p.numero.toLowerCase().includes(q));
  }, [pedidos, query]);

  const grupos = useMemo(() => {
    if (!agruparPorRecepcion) return null;
    const mapa: Record<Grupo, PedidoRow[]> = { en_curso: [], enviados: [], recibidos: [] };
    for (const p of filtrados) mapa[grupoDe(p.estado)].push(p);
    return mapa;
  }, [filtrados, agruparPorRecepcion]);

  function filaPedido(p: PedidoRow) {
    const unidades = p.pedido_items.reduce((acc, i) => acc + i.cantidad_solicitada, 0);
    return (
      <tr key={p.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
        <td className="px-0 py-0">
          <Link href={`/pedidos/${p.id}`} className="block px-[14px] py-[9px] font-medium text-text">
            {p.numero}
          </Link>
        </td>
        <td className="px-[14px] py-[9px] align-middle">
          <EstadoPedidoBadge estado={p.estado} />
        </td>
        <td className="px-[14px] py-[9px] align-middle text-text-2">
          {formatoFecha.format(new Date(p.fecha_creacion))}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {p.pedido_items.length}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
          {unidades}
        </td>
      </tr>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Pedidos</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por número…"
            className="w-[200px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
          <span className="whitespace-nowrap text-[12px] text-text-3">
            {filtrados.length} de {pedidos.length}
          </span>
          {puedeCrear && (
            <Link
              href="/pedidos/nuevo"
              className="whitespace-nowrap rounded-[6px] bg-moe px-[12px] py-[6px] text-[13px] font-medium text-white hover:bg-moe/90"
            >
              Nuevo pedido
            </Link>
          )}
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          {pedidos.length === 0 ? (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">Todavía no hay pedidos</p>
              <p className="text-[12.5px] text-text-3">
                Los pedidos de Laprida a Olavarría van a aparecer acá.
              </p>
            </>
          ) : (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">No encontramos pedidos</p>
              <p className="text-[12.5px] text-text-3">Probá con otro número.</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Número
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Estado
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Creado
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  Productos
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  Unidades
                </th>
              </tr>
            </thead>
            <tbody>
              {grupos
                ? (["en_curso", "enviados", "recibidos"] as Grupo[]).map((g) =>
                    grupos[g].length === 0 ? null : (
                      <Fragment key={g}>
                        <tr>
                          <td
                            colSpan={5}
                            className="border-b border-border bg-bg-2 px-[14px] py-[6px] text-[11.5px] font-medium text-text-2"
                          >
                            {GRUPO_LABEL[g]} ({grupos[g].length})
                          </td>
                        </tr>
                        {grupos[g].map((p) => filaPedido(p))}
                      </Fragment>
                    ),
                  )
                : filtrados.map((p) => filaPedido(p))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
