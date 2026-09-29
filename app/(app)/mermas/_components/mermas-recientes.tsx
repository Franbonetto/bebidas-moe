import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { formatoFechaHora } from "@/app/(app)/compras/_lib/formato";
import { EmptyState } from "@/app/(app)/_components/dashboard/ui";
import { MOTIVO_MERMA_LABEL, type MotivoMerma } from "../_lib/motivos";

export type MermaFila = {
  id: string;
  cantidad: number;
  motivo: MotivoMerma;
  detalle: string | null;
  fecha: string;
  sucursal: { nombre: string } | null;
  usuario: { nombre: string } | null;
  sku:
    | (SkuPresentacion & {
        nombre: string;
        codigo_interno: string;
        producto: { nombre: string; marca: { nombre: string } | null } | null;
      })
    | null;
};

// Colores universales suaves (docs/identidad-visual.md): la rotura y el
// vencimiento son pérdida (naranja / amarillo), el consumo interno es
// información, no un problema.
const MOTIVO_CLASS: Record<MotivoMerma, string> = {
  rotura: "bg-orange-bg text-orange",
  vencido: "bg-warn-bg text-warn",
  consumo_interno: "bg-info-bg text-info",
  otro: "bg-bg-2 text-text-2",
};

export function MermasRecientes({
  mermas,
  variasSucursales,
}: {
  mermas: MermaFila[];
  variasSucursales: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Últimas mermas</h2>
        {mermas.length > 0 && (
          <span className="text-[12px] text-text-3">
            {mermas.reduce((acc, m) => acc + m.cantidad, 0)} unidades
          </span>
        )}
      </div>

      {mermas.length === 0 ? (
        <EmptyState
          title="Todavía no registraste ninguna merma"
          sub="Cuando se rompa o se venza algo, anotalo acá y el stock se descuenta solo."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Producto
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Cantidad
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Motivo
                </th>
                {variasSucursales && (
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Sucursal
                  </th>
                )}
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Cuándo
                </th>
              </tr>
            </thead>
            <tbody>
              {mermas.map((m) => (
                <tr key={m.id} className="border-b border-[#F1F1F3] last:border-b-0">
                  <td className="px-[14px] py-[9px] align-middle">
                    <p className="font-medium text-text">
                      {m.sku?.producto?.nombre ?? m.sku?.nombre ?? "Producto eliminado"}
                    </p>
                    <p className="text-[11.5px] text-text-3">
                      {m.sku
                        ? [m.sku.producto?.marca?.nombre, presentacionLabel(m.sku)]
                            .filter(Boolean)
                            .join(" — ")
                        : ""}
                    </p>
                  </td>
                  <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
                    {m.cantidad}
                  </td>
                  <td className="px-[14px] py-[9px] align-middle">
                    <span
                      className={`inline-block whitespace-nowrap rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${MOTIVO_CLASS[m.motivo]}`}
                    >
                      {MOTIVO_MERMA_LABEL[m.motivo]}
                    </span>
                    {m.detalle && (
                      <p className="mt-[3px] text-[11.5px] text-text-3">{m.detalle}</p>
                    )}
                  </td>
                  {variasSucursales && (
                    <td className="px-[14px] py-[9px] align-middle text-text-2">
                      {m.sucursal?.nombre ?? "—"}
                    </td>
                  )}
                  <td className="px-[14px] py-[9px] align-middle text-text-2">
                    {formatoFechaHora.format(new Date(m.fecha))}
                    <span className="block text-[11.5px] text-text-3">
                      {m.usuario?.nombre ?? "—"}
                    </span>
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
