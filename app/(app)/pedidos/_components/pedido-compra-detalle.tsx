"use client";

import { Fragment, useMemo, useTransition } from "react";
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
  // No null = el dueño ya abrió este detalle (pedido del usuario
  // 2026-09-22: "que a la encargada le aparezca enviado y visto cuando lo
  // vio el dueño, nada más").
  visto_en: string | null;
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

type Proveedor = { id: string; nombre: string };
const SIN_PROVEEDOR_ID = "__sin_proveedor__";

export function PedidoCompraDetalle({
  pedido,
  proveedoresPorSku,
  soloLectura,
}: {
  pedido: PedidoCompraDetalleData;
  proveedoresPorSku: Record<string, Proveedor[]>;
  // El dueño solo visualiza este pedido y su historial -- lo arma y lo
  // resuelve la encargada de Olavarría (pedido del usuario 2026-09-22).
  soloLectura: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const totalUnidades = pedido.pedidos_compra_items.reduce((acc, i) => acc + i.cantidad_solicitada, 0);

  // Mismo criterio que al armar el pedido: un ítem con más de un proveedor
  // aparece repetido en cada grupo, y sin proveedor cargado va aparte.
  const grupos = useMemo(() => {
    const porProveedor = new Map<
      string,
      { proveedor: Proveedor; items: PedidoCompraDetalleData["pedidos_compra_items"] }
    >();
    for (const item of pedido.pedidos_compra_items) {
      const proveedores = proveedoresPorSku[item.sku_id];
      if (!proveedores || proveedores.length === 0) {
        const grupo = porProveedor.get(SIN_PROVEEDOR_ID) ?? {
          proveedor: { id: SIN_PROVEEDOR_ID, nombre: "Sin proveedor asignado" },
          items: [],
        };
        grupo.items.push(item);
        porProveedor.set(SIN_PROVEEDOR_ID, grupo);
        continue;
      }
      for (const proveedor of proveedores) {
        const grupo = porProveedor.get(proveedor.id) ?? { proveedor, items: [] };
        grupo.items.push(item);
        porProveedor.set(proveedor.id, grupo);
      }
    }
    return [...porProveedor.values()].sort((a, b) => {
      if (a.proveedor.id === SIN_PROVEEDOR_ID) return 1;
      if (b.proveedor.id === SIN_PROVEEDOR_ID) return -1;
      return a.proveedor.nombre.localeCompare(b.proveedor.nombre, "es");
    });
  }, [pedido.pedidos_compra_items, proveedoresPorSku]);

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
            {pedido.estado === "resuelto" ? "Resuelto" : pedido.visto_en ? "Enviado y visto" : "Pendiente"}
          </span>
        </div>

        {!soloLectura && pedido.estado === "pendiente" && (
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
              {grupos.map((g) => (
                <Fragment key={g.proveedor.id}>
                  <tr>
                    <td
                      colSpan={3}
                      className={`border-b border-border px-[14px] py-[7px] text-[12px] font-semibold ${
                        g.proveedor.id === SIN_PROVEEDOR_ID ? "bg-warn-bg text-warn" : "bg-bg-2 text-text"
                      }`}
                    >
                      {g.proveedor.nombre} · {g.items.length} producto{g.items.length === 1 ? "" : "s"}
                    </td>
                  </tr>
                  {g.items.map((item) => (
                    <tr key={`${g.proveedor.id}-${item.id}`} className="border-b border-[#F1F1F3] last:border-b-0">
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
                </Fragment>
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
