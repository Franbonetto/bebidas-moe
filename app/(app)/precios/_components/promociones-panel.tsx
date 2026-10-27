"use client";

import { useState, useTransition } from "react";
import { activarPromocion, eliminarPromocion } from "../actions";
import { presentacionLabel } from "../../productos/_lib/presentacion";
import { formatoMoneda, formatoFecha } from "../_lib/formato";
import { PromocionForm, type PromocionSkuOpcion } from "./promocion-form";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";

export type Sucursal = { id: string; nombre: string; es_central: boolean };

export type PromocionItemRow = {
  sku_id: string;
  cantidad_requerida: number;
};

// El precio de una promo es su total, y es por sucursal: Olavarría y
// Laprida no manejan los mismos precios (20261010090000).
export type PromocionPrecioRow = {
  sucursal_id: string;
  precio_total: number;
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
  precios: PromocionPrecioRow[];
};

function resumenItems(promocion: PromocionRow, skuPorId: Map<string, PromocionSkuOpcion>) {
  return promocion.items
    .map((item) => {
      const sku = skuPorId.get(item.sku_id);
      const nombre = sku ? `${sku.producto?.nombre} (${presentacionLabel(sku)})` : "SKU eliminado";
      return promocion.tipo === "cantidad" ? `${item.cantidad_requerida}x ${nombre}` : nombre;
    })
    .join(promocion.tipo === "combo" ? " + " : "");
}

function resumenVigencia(promocion: PromocionRow) {
  if (!promocion.vigente_desde && !promocion.vigente_hasta) return "Permanente";
  const desde = promocion.vigente_desde ? formatoFecha.format(new Date(promocion.vigente_desde)) : "…";
  const hasta = promocion.vigente_hasta ? formatoFecha.format(new Date(promocion.vigente_hasta)) : "…";
  return `${desde} — ${hasta}`;
}

// Una promo corre en una sucursal si está asignada a ella (o a ninguna, que
// significa las dos) y además tiene el total cargado para esa sucursal:
// dejar el total vacío es la forma de decir que ahí no corre (promocion-form).
function correEn(promocion: PromocionRow, sucursalId: string) {
  if (promocion.sucursal_id && promocion.sucursal_id !== sucursalId) return false;
  return promocion.precios.some((p) => p.sucursal_id === sucursalId);
}

function totalEn(promocion: PromocionRow, sucursalId: string) {
  return promocion.precios.find((p) => p.sucursal_id === sucursalId)?.precio_total ?? null;
}

function contarPromociones(cantidad: number) {
  return cantidad === 1 ? "1 promoción" : `${cantidad} promociones`;
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

  const pedirPin = usePinOperaciones();

  async function toggleActivo(promocion: PromocionRow) {
    setError(null);
    const pin = await pedirPin();
    if (!pin) return;
    startTransition(async () => {
      const resultado = await activarPromocion(promocion.id, !promocion.activo, pin);
      if ("error" in resultado) setError(resultado.error);
    });
  }

  async function eliminar(promocion: PromocionRow) {
    if (!window.confirm(`¿Eliminar la promoción "${promocion.nombre}"? Esta acción no se puede deshacer.`)) return;
    setError(null);
    const pin = await pedirPin();
    if (!pin) return;
    startTransition(async () => {
      const resultado = await eliminarPromocion(promocion.id, pin);
      if ("error" in resultado) setError(resultado.error);
    });
  }

  // Un grupo por sucursal (Olavarría primero: la lista ya viene ordenada por
  // es_central). La misma promo aparece en los dos grupos si corre en los
  // dos, cada uno con su propio total: es una sola promo, no un duplicado.
  const gruposPorSucursal = sucursales.map((sucursal) => ({
    clave: sucursal.id,
    sucursalId: sucursal.id as string | null,
    titulo: sucursal.nombre,
    vacio: `Todavía no hay promociones que corran en ${sucursal.nombre}. Una promo corre acá cuando tiene su total cargado para esta sucursal.`,
    promociones: promociones.filter((p) => correEn(p, sucursal.id)),
  }));

  // Las que no corren en ninguna sucursal siguen a la vista acá, en vez de
  // desaparecer de la pantalla.
  const sinTotal = promociones.filter((p) => !sucursales.some((s) => correEn(p, s.id)));

  const grupos =
    sinTotal.length > 0
      ? [
          ...gruposPorSucursal,
          {
            clave: "sin-total",
            sucursalId: null,
            titulo: "Sin total cargado",
            vacio: "",
            promociones: sinTotal,
          },
        ]
      : gruposPorSucursal;

  function otrasSucursales(promocion: PromocionRow, sucursalId: string) {
    return sucursales
      .filter((s) => s.id !== sucursalId && correEn(promocion, s.id))
      .map((s) => s.nombre);
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Promociones</h2>
        <button
          type="button"
          onClick={() => setFormAbierto("nueva")}
          className="whitespace-nowrap rounded-[6px] bg-moe px-[12px] py-[8px] text-[13px] font-medium text-white hover:bg-moe/90 sm:px-[11px] sm:py-[6px] sm:text-[12.5px]"
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
        <>
        {/* Celular: una tarjeta por promoción, agrupadas por sucursal. La tabla
            tiene seis columnas y en un teléfono no entra (identidad-visual.md:
            las tablas se adaptan, no se comprimen). */}
        <div className="md:hidden">
          {grupos.map((grupo) => (
            <div key={grupo.clave}>
              <div className="border-b border-border bg-bg-2 px-[14px] py-[7px]">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-text-2">{grupo.titulo}</span>
                <span className="ml-[6px] text-[12px] text-text-3">
                  · {contarPromociones(grupo.promociones.length)}
                </span>
              </div>

              {grupo.promociones.length === 0 ? (
                <p className="border-b border-border px-[14px] py-[12px] text-[12.5px] text-text-3">{grupo.vacio}</p>
              ) : (
                <div className="flex flex-col divide-y divide-[#F1F1F3] border-b border-border">
                  {grupo.promociones.map((pr) => {
                    const total = grupo.sucursalId ? totalEn(pr, grupo.sucursalId) : null;
                    const otras = grupo.sucursalId ? otrasSucursales(pr, grupo.sucursalId) : [];
                    return (
                      <div key={pr.id} className="px-[14px] py-[11px]">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[15px] font-medium leading-tight text-text">{pr.nombre}</p>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => toggleActivo(pr)}
                            className={`shrink-0 rounded-[4px] px-[9px] py-[3px] text-[12px] font-medium ${
                              pr.activo ? "bg-ok-bg text-ok" : "bg-bg-2 text-text-3"
                            }`}
                          >
                            {pr.activo ? "Activa" : "Inactiva"}
                          </button>
                        </div>

                        <p className="mt-[3px] text-[12.5px] text-text-3">
                          {pr.tipo === "combo" ? "Combo" : "Cantidad"} · {resumenVigencia(pr)}
                        </p>

                        <p className="mt-[4px] text-[13px] text-text-2">{resumenItems(pr, skuPorId)}</p>
                        <p className="text-[13px] tabular-nums text-text">
                          {total != null ? formatoMoneda.format(total) : "Sin total cargado"}
                        </p>
                        {otras.length > 0 && (
                          <p className="text-[12px] text-text-3">También corre en {otras.join(" y ")}</p>
                        )}

                        <div className="mt-[9px] flex gap-4">
                          <button
                            type="button"
                            onClick={() => setFormAbierto(pr)}
                            className="text-[13px] font-medium text-moe"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => eliminar(pr)}
                            className="text-[13px] text-text-3"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <table className="hidden w-full text-[13px] md:table">
          <thead>
            <tr className="border-b border-border text-left text-[11.5px] uppercase text-text-3">
              <th className="px-[14px] py-[8px] font-medium">Nombre</th>
              <th className="px-[14px] py-[8px] font-medium">Tipo</th>
              <th className="px-[14px] py-[8px] font-medium">Total</th>
              <th className="px-[14px] py-[8px] font-medium">Vigencia</th>
              <th className="px-[14px] py-[8px] font-medium">Estado</th>
              <th className="px-[14px] py-[8px] font-medium"></th>
            </tr>
          </thead>
          {grupos.map((grupo) => (
            <tbody key={grupo.clave}>
              <tr className="border-b border-border bg-bg-2">
                <td colSpan={6} className="px-[14px] py-[6px]">
                  <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-2">
                    {grupo.titulo}
                  </span>
                  <span className="ml-[6px] text-[11.5px] text-text-3">
                    · {contarPromociones(grupo.promociones.length)}
                  </span>
                </td>
              </tr>

              {grupo.promociones.length === 0 ? (
                <tr className="border-b border-border">
                  <td colSpan={6} className="px-[14px] py-[12px] text-[12.5px] text-text-3">
                    {grupo.vacio}
                  </td>
                </tr>
              ) : (
                grupo.promociones.map((p) => {
                  const total = grupo.sucursalId ? totalEn(p, grupo.sucursalId) : null;
                  const otras = grupo.sucursalId ? otrasSucursales(p, grupo.sucursalId) : [];
                  return (
                    <tr key={p.id} className="border-b border-[#F1F1F3] hover:bg-bg-2">
                      <td className="px-[14px] py-[9px]">
                        <div className="font-medium text-text">{p.nombre}</div>
                        <div className="text-[11.5px] text-text-3">{resumenItems(p, skuPorId)}</div>
                        {otras.length > 0 && (
                          <div className="text-[11.5px] text-text-3">También corre en {otras.join(" y ")}</div>
                        )}
                      </td>
                      <td className="px-[14px] py-[9px] text-text-2">{p.tipo === "combo" ? "Combo" : "Cantidad"}</td>
                      <td className="px-[14px] py-[9px] tabular-nums text-text-2">
                        {total != null ? formatoMoneda.format(total) : "—"}
                      </td>
                      <td className="px-[14px] py-[9px] text-text-2">{resumenVigencia(p)}</td>
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
                })
              )}
            </tbody>
          ))}
        </table>
        </>
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
