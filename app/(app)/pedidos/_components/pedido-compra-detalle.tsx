"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { formatoFechaHora } from "../../compras/_lib/formato";
import { eliminarPedidoCompra, resolverPedidoCompra } from "../actions";

type SkuInfo = SkuPresentacion & {
  nombre: string;
  codigo_interno: string;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

export type PedidoCompraDetalleData = {
  id: string;
  numero: string;
  estado: "pendiente" | "resuelto";
  fecha_creacion: string;
  fecha_resolucion: string | null;
  observaciones: string | null;
  creador: { nombre: string } | null;
  resolutor: { nombre: string } | null;
  pedidos_compra_items: {
    id: string;
    sku_id: string;
    cantidad_sugerida: number;
    cantidad_solicitada: number;
    sku: SkuInfo | null;
  }[];
};

export function PedidoCompraDetalle({ pedido }: { pedido: PedidoCompraDetalleData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const totalUnidades = pedido.pedidos_compra_items.reduce((acc, i) => acc + i.cantidad_solicitada, 0);

  function marcarResuelto() {
    startTransition(async () => {
      await resolverPedidoCompra(pedido.id);
      router.refresh();
    });
  }

  function eliminar() {
    if (!window.confirm("¿Eliminar este pedido de compra? No se puede deshacer.")) return;
    startTransition(async () => {
      const resultado = await eliminarPedidoCompra(pedido.id);
      if (!("error" in resultado)) router.push("/pedidos");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">{pedido.numero}</h2>
            <p className="mt-[2px] text-[12.5px] text-text-3">
              Armado por {pedido.creador?.nombre ?? "—"} · {formatoFechaHora.format(new Date(pedido.fecha_creacion))}
              {pedido.fecha_resolucion
                ? ` · Resuelto por ${pedido.resolutor?.nombre ?? "—"} el ${formatoFechaHora.format(new Date(pedido.fecha_resolucion))}`
                : ""}
            </p>
          </div>
          <span
            className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
              pedido.estado === "resuelto" ? "bg-ok-bg text-ok" : "bg-info-bg text-info"
            }`}
          >
            {pedido.estado === "resuelto" ? "Resuelto" : "Pendiente"}
          </span>
        </div>

        {pedido.estado === "pendiente" && (
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={eliminar}
              disabled={pending}
              className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
            >
              Eliminar
            </button>
            <button
              type="button"
              onClick={marcarResuelto}
              disabled={pending}
              className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
            >
              Marcar como resuelto
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border px-[14px] py-[11px]">
          <h3 className="text-[13px] font-semibold text-text">Productos a comprar</h3>
          <span className="text-[12px] text-text-3">
            {pedido.pedidos_compra_items.length} producto{pedido.pedidos_compra_items.length === 1 ? "" : "s"} ·{" "}
            {totalUnidades} unidades
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Producto
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Sugerido
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Pedido
                </th>
              </tr>
            </thead>
            <tbody>
              {pedido.pedidos_compra_items.map((item) => (
                <tr key={item.id} className="border-b border-[#F1F1F3] last:border-b-0">
                  <td className="px-[14px] py-[9px] align-middle">
                    <p className="font-medium text-text">
                      {item.sku?.producto?.nombre ?? item.sku?.nombre ?? "SKU eliminado"}
                    </p>
                    <p className="text-[11.5px] text-text-3">
                      {item.sku?.producto?.marca?.nombre} — {item.sku ? presentacionLabel(item.sku) : ""}
                    </p>
                  </td>
                  <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                    {item.cantidad_sugerida}
                  </td>
                  <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
                    {item.cantidad_solicitada}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Link href="/pedidos" className="text-[12.5px] text-text-2 hover:text-text">
        ← Volver a pedidos
      </Link>
    </div>
  );
}
