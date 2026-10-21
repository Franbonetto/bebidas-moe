"use client";

import Link from "next/link";
import { useState } from "react";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { Tabla, Td, Th } from "../../_components/tabla";

// Las ventas del día, una por fila, y al tocar una se abren sus líneas sin
// salir de la pantalla (pedido del usuario 2026-10-21: "ver la caja de ese
// día con todas las ventas y productos que se vendieron").
//
// Todo llega armado desde el servidor -- hora ya formateada en hora
// argentina, medios de pago ya resueltos desde venta_pagos --: acá no se
// calcula nada, solo se despliega.

export type LineaVenta = {
  nombre: string;
  detalle: string;
  cantidad: number;
  importe: number;
  // Línea con promoción aplicada: se marca para que el dueño entienda por
  // qué el importe no es el precio de lista.
  promo: boolean;
  // Producto particular: lo que se cobró sin estar en el catálogo.
  particular: boolean;
};

export type VentaDelDia = {
  id: string;
  hora: string;
  sucursal: string;
  usuario: string;
  medios: string;
  total: number;
  esEnvio: boolean;
  items: LineaVenta[];
};

export function VentasDia({ ventas }: { ventas: VentaDelDia[] }) {
  const [abierta, setAbierta] = useState<string | null>(null);

  return (
    <Tabla>
      <thead>
        <tr>
          <Th>Hora</Th>
          <Th>Sucursal</Th>
          <Th>Quién vendió</Th>
          <Th>Con qué pagó</Th>
          <Th align="right">Productos</Th>
          <Th align="right">Total</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {ventas.map((v) => {
          const abiertaEsta = abierta === v.id;
          const unidades = v.items.reduce((acc, i) => acc + i.cantidad, 0);
          return [
            <tr
              key={v.id}
              onClick={() => setAbierta(abiertaEsta ? null : v.id)}
              className={`cursor-pointer border-b border-[#F1F1F3] ${
                abiertaEsta ? "bg-bg-2" : "hover:bg-[#FAFAFB]"
              }`}
            >
              <Td>
                <span className="mr-[6px] inline-block w-[8px] text-text-3">
                  {abiertaEsta ? "▾" : "▸"}
                </span>
                <span className="tabular-nums text-text">{v.hora}</span>
              </Td>
              <Td>{v.sucursal}</Td>
              <Td>{v.usuario}</Td>
              <Td>
                {v.medios}
                {v.esEnvio && (
                  <span className="ml-[6px] rounded-[5px] bg-info-bg px-[6px] py-[1px] text-[11px] font-medium text-info">
                    Envío
                  </span>
                )}
              </Td>
              <Td align="right" numero>
                {unidades}
              </Td>
              <Td align="right" numero>
                <span className="font-medium text-text">{formatoMoneda.format(v.total)}</span>
              </Td>
              <Td align="right">
                <Link
                  href={`/ticket/${v.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[12px] font-medium text-moe hover:underline"
                >
                  Ticket
                </Link>
              </Td>
            </tr>,

            abiertaEsta ? (
              <tr key={`${v.id}:detalle`} className="border-b border-[#F1F1F3] bg-bg-2">
                <td colSpan={7} className="px-[14px] pb-[11px] pt-[2px]">
                  <div className="flex flex-col gap-[4px]">
                    {v.items.map((i, idx) => (
                      <div
                        key={idx}
                        className="flex items-baseline justify-between gap-3 text-[12.5px]"
                      >
                        <span className="min-w-0 text-text-2">
                          <span className="tabular-nums text-text-3">{i.cantidad}×</span>{" "}
                          <span className="font-medium text-text">{i.nombre}</span>
                          {i.detalle && <span className="text-text-3"> · {i.detalle}</span>}
                          {i.promo && (
                            <span className="ml-[6px] rounded-[5px] bg-ok-bg px-[6px] py-[1px] text-[11px] font-medium text-ok">
                              Promo
                            </span>
                          )}
                          {i.particular && (
                            <span className="ml-[6px] rounded-[5px] bg-bg px-[6px] py-[1px] text-[11px] font-medium text-text-2">
                              Particular
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums text-text">
                          {formatoMoneda.format(i.importe)}
                        </span>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ) : null,
          ];
        })}
      </tbody>
    </Tabla>
  );
}
