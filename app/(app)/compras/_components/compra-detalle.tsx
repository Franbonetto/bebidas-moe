"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import {
  agregarLineaCompra,
  actualizarLineaCompra,
  eliminarLineaCompra,
  confirmarCompra,
  eliminarCompra,
} from "../actions";
import { formatoFechaHora, formatoMoneda } from "../_lib/formato";
import { EstadoCompraBadge, type Compra } from "./compras-table";
import { SkuPicker, type SkuCatalogo } from "./sku-picker";
import { RecepcionForm, type LineaPendiente } from "./recepcion-form";

type SkuInfo = SkuPresentacion & {
  nombre: string;
  codigo_interno: string;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

export type ItemCompraDetalle = {
  id: string;
  sku_id: string;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
  recibido_previo: number;
  pendiente: number;
  sku: SkuInfo | null;
};

export type RecepcionDetalle = {
  id: string;
  fecha: string;
  estado: "pendiente" | "recibida";
  usuario: { nombre: string } | null;
  recepcion_items: {
    compra_item_id: string;
    cantidad_recibida: number;
    diferencia: number | null;
    motivo_diferencia: string | null;
  }[];
};

export type CompraDetalleData = Compra & {
  items: ItemCompraDetalle[];
};

const inputCelda =
  "w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe";

function nombreSku(sku: SkuInfo | null) {
  if (!sku) return "SKU eliminado";
  return sku.producto?.nombre ?? sku.nombre;
}

function presentacionSku(sku: SkuInfo | null) {
  if (!sku) return "";
  return [sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ");
}

export function CompraDetalle({
  compra,
  recepciones,
  skusDisponibles,
}: {
  compra: CompraDetalleData;
  recepciones: RecepcionDetalle[];
  skusDisponibles: SkuCatalogo[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mostrarRecepcion, setMostrarRecepcion] = useState(false);

  const excluirIds = useMemo(() => new Set(compra.items.map((i) => i.sku_id)), [compra.items]);
  const lineasPendientes: LineaPendiente[] = compra.items
    .filter((i) => i.pendiente > 0)
    .map((i) => ({
      compra_item_id: i.id,
      sku_id: i.sku_id,
      nombre: nombreSku(i.sku),
      presentacion: presentacionSku(i.sku),
      pendiente: i.pendiente,
    }));

  const itemsPorId = useMemo(() => new Map(compra.items.map((i) => [i.id, i])), [compra.items]);

  function ejecutar(accion: () => Promise<{ error: string } | { ok: true } | { id: string }>) {
    setError(null);
    startTransition(async () => {
      const resultado = await accion();
      if ("error" in resultado) setError(resultado.error);
    });
  }

  function onAgregarLinea(sku: SkuCatalogo) {
    ejecutar(() => agregarLineaCompra(compra.id, { sku_id: sku.id, cantidad: 1, costo_unitario: 0 }));
  }

  function onCommitLinea(item: ItemCompraDetalle, cantidad: number, costoUnitario: number) {
    if (cantidad === item.cantidad && costoUnitario === item.costo_unitario) return;
    ejecutar(() => actualizarLineaCompra(compra.id, item.id, cantidad, costoUnitario));
  }

  function onQuitarLinea(itemId: string) {
    ejecutar(() => eliminarLineaCompra(compra.id, itemId));
  }

  function onConfirmarCompra() {
    ejecutar(() => confirmarCompra(compra.id));
  }

  function onEliminarCompra() {
    if (!window.confirm("¿Eliminar esta compra en borrador? No se puede deshacer.")) return;
    startTransition(async () => {
      const resultado = await eliminarCompra(compra.id);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push("/compras");
    });
  }

  const esBorrador = compra.estado === "borrador";
  const hayPendiente = lineasPendientes.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">
              {compra.proveedor?.nombre_comercial ?? compra.proveedor?.razon_social ?? "Proveedor"}
            </h2>
            <p className="mt-[2px] text-[12.5px] text-text-3">
              {compra.numero_factura ? `Factura ${compra.numero_factura}` : "Sin número de factura"}
              {compra.fecha_factura ? ` · ${compra.fecha_factura}` : ""}
            </p>
          </div>
          <EstadoCompraBadge estado={compra.estado} />
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border px-[14px] py-[11px]">
          <h3 className="text-[13px] font-semibold text-text">Líneas</h3>
          {esBorrador && (
            <span className="text-[12px] text-text-3">Editable mientras esté en borrador</span>
          )}
        </div>

        {esBorrador && (
          <div className="border-b border-border px-[14px] py-[10px]">
            <SkuPicker skus={skusDisponibles} excluirIds={excluirIds} onSelect={onAgregarLinea} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  SKU
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Cantidad
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Costo unit.
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Subtotal
                </th>
                {!esBorrador && (
                  <>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Recibido
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Pendiente
                    </th>
                  </>
                )}
                {esBorrador && <th className="w-[40px] border-b border-border bg-bg-2 px-[14px] py-[7px]" />}
              </tr>
            </thead>
            <tbody>
              {compra.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-[14px] py-[16px] text-center text-[12.5px] text-text-3">
                    Todavía no hay líneas en esta compra.
                  </td>
                </tr>
              ) : (
                compra.items.map((item) => (
                  <tr key={item.id} className="border-b border-[#F1F1F3] last:border-b-0">
                    <td className="px-[14px] py-[9px] align-middle">
                      <p className="font-medium text-text">{nombreSku(item.sku)}</p>
                      <p className="text-[11.5px] text-text-3">{presentacionSku(item.sku)}</p>
                    </td>
                    {esBorrador ? (
                      <>
                        <td className="px-[14px] py-[9px] align-middle">
                          <input
                            type="number"
                            min={1}
                            defaultValue={item.cantidad}
                            className={inputCelda}
                            onBlur={(e) =>
                              onCommitLinea(item, Number(e.target.value), item.costo_unitario)
                            }
                          />
                        </td>
                        <td className="px-[14px] py-[9px] align-middle">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            defaultValue={item.costo_unitario}
                            className={inputCelda}
                            onBlur={(e) => onCommitLinea(item, item.cantidad, Number(e.target.value))}
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                          {item.cantidad}
                        </td>
                        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                          {formatoMoneda.format(item.costo_unitario)}
                        </td>
                      </>
                    )}
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text">
                      {formatoMoneda.format(item.subtotal)}
                    </td>
                    {!esBorrador && (
                      <>
                        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                          {item.recibido_previo}
                        </td>
                        <td
                          className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
                            item.pendiente > 0 ? "font-medium text-warn" : "text-text-3"
                          }`}
                        >
                          {item.pendiente}
                        </td>
                      </>
                    )}
                    {esBorrador && (
                      <td className="px-[14px] py-[9px] text-right align-middle">
                        <button
                          type="button"
                          onClick={() => onQuitarLinea(item.id)}
                          className="text-[12px] text-text-3 hover:text-err"
                        >
                          Quitar
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-[14px] py-[10px]">
          <p className="text-[13px] font-semibold text-text">
            Total: <span className="tabular-nums">{formatoMoneda.format(compra.total)}</span>
          </p>
          {esBorrador && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onEliminarCompra}
                disabled={pending}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
              >
                Eliminar compra
              </button>
              <button
                type="button"
                onClick={onConfirmarCompra}
                disabled={pending || compra.items.length === 0}
                className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                Confirmar compra
              </button>
            </div>
          )}
        </div>

        {error && <p className="border-t border-border px-[14px] py-[8px] text-[12.5px] text-err">{error}</p>}
      </div>

      {!esBorrador && (
        <div className="overflow-hidden rounded-card border border-border bg-bg">
          <div className="flex items-center justify-between border-b border-border px-[14px] py-[11px]">
            <h3 className="text-[13px] font-semibold text-text">Recepciones</h3>
            {compra.estado === "confirmada" && hayPendiente && (
              <button
                type="button"
                onClick={() => setMostrarRecepcion(true)}
                className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90"
              >
                Nueva recepción
              </button>
            )}
          </div>

          {recepciones.length === 0 ? (
            <div className="px-[14px] py-[22px] text-center">
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                Todavía no hay recepciones
              </p>
              <p className="text-[12.5px] text-text-3">
                Cuando llegue la mercadería, registrala acá para actualizar el stock.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {recepciones.map((r) => (
                <div key={r.id} className="border-b border-[#F1F1F3] px-[14px] py-[10px] last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12.5px] text-text-2">
                      {formatoFechaHora.format(new Date(r.fecha))} · {r.usuario?.nombre ?? "—"}
                    </p>
                    <span
                      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
                        r.estado === "recibida" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"
                      }`}
                    >
                      {r.estado === "recibida" ? "Recibida" : "Pendiente"}
                    </span>
                  </div>
                  <div className="mt-[6px] flex flex-col gap-[3px]">
                    {r.recepcion_items.map((ri) => {
                      const item = itemsPorId.get(ri.compra_item_id);
                      return (
                        <p key={ri.compra_item_id} className="text-[12.5px] text-text-2">
                          {nombreSku(item?.sku ?? null)}: {ri.cantidad_recibida}
                          {ri.diferencia != null && ri.diferencia !== 0 && (
                            <span className="text-warn">
                              {" "}
                              (diferencia {ri.diferencia > 0 ? "+" : ""}
                              {ri.diferencia}
                              {ri.motivo_diferencia ? ` — ${ri.motivo_diferencia}` : ""})
                            </span>
                          )}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mostrarRecepcion && (
        <RecepcionForm
          compraId={compra.id}
          lineas={lineasPendientes}
          onClose={() => setMostrarRecepcion(false)}
        />
      )}
    </div>
  );
}
