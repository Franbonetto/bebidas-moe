"use client";

import { useState, useTransition } from "react";
import { activarPromocion, eliminarPromocion } from "../actions";
import { presentacionLabel } from "../../productos/_lib/presentacion";
import { formatoMoneda, formatoFecha } from "../_lib/formato";
import { PromocionForm, type PromocionSkuOpcion } from "./promocion-form";

export type Sucursal = { id: string; nombre: string; es_central: boolean };

export type PromocionItemRow = {
  sku_id: string;
  cantidad_requerida: number;
  precio_promocional: number;
};

export type PromocionRow = {
  id: string;
  nombre: string;
  tipo: "combo" | "cantidad";
  sucursal_id: string | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  activo: boolean;
  items: PromocionItemRow[];
};

function resumenItems(promocion: PromocionRow, skuPorId: Map<string, PromocionSkuOpcion>) {
  return promocion.items
    .map((item) => {
      const sku = skuPorId.get(item.sku_id);
      const nombre = sku ? `${sku.producto?.nombre} (${presentacionLabel(sku)})` : "SKU eliminado";
      return promocion.tipo === "cantidad"
        ? `${item.cantidad_requerida}x ${nombre} — ${formatoMoneda.format(item.precio_promocional)}`
        : `${nombre} ${formatoMoneda.format(item.precio_promocional)}`;
    })
    .join(promocion.tipo === "combo" ? " + " : "");
}

export function PromocionesPanel({
  sucursales,
  skus,
  promociones,
}: {
  sucursales: Sucursal[];
  skus: PromocionSkuOpcion[];
  promociones: PromocionRow[];
}) {
  const [formAbierto, setFormAbierto] = useState<"nueva" | PromocionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const skuPorId = new Map(skus.map((s) => [s.id, s]));

  function toggleActivo(promocion: PromocionRow) {
    setError(null);
    startTransition(async () => {
      const resultado = await activarPromocion(promocion.id, !promocion.activo);
      if ("error" in resultado) setError(resultado.error);
    });
  }

  function eliminar(promocion: PromocionRow) {
    if (!window.confirm(`¿Eliminar la promoción "${promocion.nombre}"? Esta acción no se puede deshacer.`)) return;
    setError(null);
    startTransition(async () => {
      const resultado = await eliminarPromocion(promocion.id);
      if ("error" in resultado) setError(resultado.error);
    });
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Promociones</h2>
        <button
          type="button"
          onClick={() => setFormAbierto("nueva")}
          className="whitespace-nowrap rounded-[6px] bg-moe px-[11px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90"
        >
          Nueva promoción
        </button>
      </div>

      {error && <p className="px-[14px] pt-[10px] text-[12.5px] text-err">{error}</p>}

      {promociones.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          <p className="mb-[3px] text-[13.5px] font-semibold text-text">Todavía no hay promociones cargadas</p>
          <p className="text-[12.5px] text-text-3">
            Un combo (ej. Fernet + Coca-Cola) o un 2x aparecen automáticamente en el POS apenas se guardan acá.
          </p>
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11.5px] uppercase text-text-3">
              <th className="px-[14px] py-[8px] font-medium">Nombre</th>
              <th className="px-[14px] py-[8px] font-medium">Tipo</th>
              <th className="px-[14px] py-[8px] font-medium">Sucursal</th>
              <th className="px-[14px] py-[8px] font-medium">Vigencia</th>
              <th className="px-[14px] py-[8px] font-medium">Estado</th>
              <th className="px-[14px] py-[8px] font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {promociones.map((p) => {
              const sucursal = sucursales.find((s) => s.id === p.sucursal_id);
              return (
                <tr key={p.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-bg-2">
                  <td className="px-[14px] py-[9px]">
                    <div className="font-medium text-text">{p.nombre}</div>
                    <div className="text-[11.5px] text-text-3">{resumenItems(p, skuPorId)}</div>
                  </td>
                  <td className="px-[14px] py-[9px] text-text-2">{p.tipo === "combo" ? "Combo" : "Cantidad"}</td>
                  <td className="px-[14px] py-[9px] text-text-2">{sucursal ? sucursal.nombre : "Ambas"}</td>
                  <td className="px-[14px] py-[9px] text-text-2">
                    {p.vigente_desde || p.vigente_hasta
                      ? `${p.vigente_desde ? formatoFecha.format(new Date(p.vigente_desde)) : "…"} — ${
                          p.vigente_hasta ? formatoFecha.format(new Date(p.vigente_hasta)) : "…"
                        }`
                      : "Permanente"}
                  </td>
                  <td className="px-[14px] py-[9px]">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggleActivo(p)}
                      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
                        p.activo ? "bg-ok-bg text-ok" : "bg-bg-2 text-text-3"
                      }`}
                    >
                      {p.activo ? "Activa" : "Inactiva"}
                    </button>
                  </td>
                  <td className="px-[14px] py-[9px] text-right">
                    <button
                      type="button"
                      onClick={() => setFormAbierto(p)}
                      className="mr-3 text-[12.5px] text-text-2 hover:text-moe"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => eliminar(p)}
                      className="text-[12.5px] text-text-3 hover:text-err"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {formAbierto && (
        <PromocionForm
          sucursales={sucursales}
          skus={skus}
          promocion={formAbierto === "nueva" ? null : formAbierto}
          onClose={() => setFormAbierto(null)}
        />
      )}
    </div>
  );
}
