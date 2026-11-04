import { presentacionLabel } from "../../productos/_lib/presentacion";
import { formatoMoneda, formatoFecha } from "../_lib/formato";
import type { PromocionSkuOpcion } from "./promocion-form";
import type { PromocionRow } from "./promociones-panel";

// Panel informativo para el encargado de Laprida: no edita nada, solo
// muestra las promociones que corren hoy en su sucursal (pedido del
// usuario 2026-11-04). La pestaña de promociones sigue siendo exclusiva
// de ve_costos() -- esto es la versión de solo lectura para quien no la ve.
function resumenItems(promocion: PromocionRow, skuPorId: Map<string, PromocionSkuOpcion>) {
  return promocion.items
    .map((item) => {
      const sku = skuPorId.get(item.sku_id);
      const nombre = sku ? `${sku.producto?.nombre} (${presentacionLabel(sku)})` : "SKU eliminado";
      return item.cantidad_requerida > 1 ? `${item.cantidad_requerida}x ${nombre}` : nombre;
    })
    .join(promocion.tipo === "combo" ? " + " : "");
}

function resumenVigencia(promocion: PromocionRow) {
  if (!promocion.vigente_desde && !promocion.vigente_hasta) return "Activa sin fecha límite";
  const desde = promocion.vigente_desde ? formatoFecha.format(new Date(promocion.vigente_desde)) : "…";
  const hasta = promocion.vigente_hasta ? formatoFecha.format(new Date(promocion.vigente_hasta)) : "…";
  return `${desde} — ${hasta}`;
}

export function PromocionesVigentesPanel({
  sucursalId,
  skus,
  promociones,
}: {
  sucursalId: string;
  skus: PromocionSkuOpcion[];
  promociones: PromocionRow[];
}) {
  const skuPorId = new Map(skus.map((s) => [s.id, s]));

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Promociones vigentes</h2>
        <p className="mt-[2px] text-[12px] text-text-3">
          Solo a modo informativo: se cargan desde Olavarría y se aplican solas en el POS.
        </p>
      </div>

      {promociones.length === 0 ? (
        <p className="px-[14px] py-[16px] text-[12.5px] text-text-3">
          No hay promociones vigentes en este momento.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-[#F1F1F3]">
          {promociones.map((p) => {
            const total = p.precios.find((pr) => pr.sucursal_id === sucursalId)?.precio_total ?? null;
            return (
              <div key={p.id} className="flex items-start justify-between gap-3 px-[14px] py-[10px]">
                <div>
                  <p className="text-[13.5px] font-medium text-text">{p.nombre}</p>
                  <p className="mt-[2px] text-[12px] text-text-2">{resumenItems(p, skuPorId)}</p>
                  <p className="mt-[2px] text-[11.5px] text-text-3">{resumenVigencia(p)}</p>
                </div>
                <p className="shrink-0 text-[13.5px] font-medium tabular-nums text-text">
                  {total != null ? formatoMoneda.format(total) : "—"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
