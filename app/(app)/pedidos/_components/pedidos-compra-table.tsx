import Link from "next/link";
import { formatoFecha } from "../../compras/_lib/formato";

export type PedidoCompraRow = {
  id: string;
  numero: string;
  estado: "pendiente" | "resuelto";
  fecha_creacion: string;
  // No null = el dueño ya abrió el detalle (pedido del usuario 2026-09-22:
  // "que a la encargada le aparezca enviado y visto cuando lo vio el
  // dueño, nada más").
  visto_en: string | null;
  pedidos_compra_items: { cantidad_solicitada: number }[];
};

export function PedidosCompraTable({
  pedidos,
  puedeCrear,
}: {
  pedidos: PedidoCompraRow[];
  // El dueño solo visualiza estos pedidos y su historial -- los arma la
  // encargada de Olavarría, no él (pedido del usuario 2026-09-22).
  puedeCrear: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <div>
          <h2 className="text-[13px] font-semibold text-text">Pedidos de compra</h2>
          <p className="text-[11.5px] text-text-3">
            Lo que la encargada arma semanalmente para que el dueño sepa qué comprarle a los
            proveedores.
          </p>
        </div>
        {puedeCrear && (
          <Link
            href="/pedidos/compra/nueva"
            className="whitespace-nowrap rounded-[6px] bg-moe px-[12px] py-[6px] text-[13px] font-medium text-white hover:bg-moe/90"
          >
            Nuevo pedido de compra
          </Link>
        )}
      </div>

      {pedidos.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          <p className="mb-[3px] text-[13.5px] font-semibold text-text">Todavía no hay pedidos de compra</p>
          <p className="text-[12.5px] text-text-3">
            {puedeCrear ? "Se arman desde acá, semana a semana." : "Los arma la encargada, semana a semana."}
          </p>
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
              {pedidos.map((p) => {
                const unidades = p.pedidos_compra_items.reduce((acc, i) => acc + i.cantidad_solicitada, 0);
                return (
                  <tr key={p.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
                    <td className="px-0 py-0">
                      <Link href={`/pedidos/compra/${p.id}`} className="block px-[14px] py-[9px] font-medium text-text">
                        {p.numero}
                      </Link>
                    </td>
                    <td className="px-[14px] py-[9px] align-middle">
                      <span
                        className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
                          p.estado === "resuelto" ? "bg-ok-bg text-ok" : "bg-info-bg text-info"
                        }`}
                      >
                        {p.estado === "resuelto" ? "Resuelto" : p.visto_en ? "Enviado y visto" : "Pendiente"}
                      </span>
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text-2">
                      {formatoFecha.format(new Date(p.fecha_creacion))}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {p.pedidos_compra_items.length}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
                      {unidades}
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
