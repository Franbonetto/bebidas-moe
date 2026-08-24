"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { formatoFechaHora } from "../../compras/_lib/formato";
import {
  confirmarPreparacion,
  eliminarPedido,
  enviarPedido,
  guardarAvancePreparacion,
} from "../actions";
import { EstadoPedidoBadge, type EstadoPedido } from "./estado-pedido-badge";
import { DespachoForm, type LineaPorDespachar } from "./despacho-form";
import { RecepcionTransferenciaForm, type LineaTransferenciaPendiente } from "./recepcion-transferencia-form";
import { CierreManualForm } from "./cierre-manual-form";

type SkuInfo = SkuPresentacion & {
  nombre: string;
  codigo_interno: string;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

export type PedidoItemDetalle = {
  id: string;
  sku_id: string;
  cantidad_solicitada: number;
  cantidad_preparada: number | null;
  cantidad_pendiente: number | null;
  observacion_encargado: string | null;
  sku: SkuInfo | null;
};

export type TransferenciaItemDetalle = {
  id: string;
  pedido_item_id: string;
  sku_id: string;
  cantidad_despachada: number;
  cantidad_recibida: number | null;
  diferencia: number | null;
  motivo_diferencia: string | null;
};

export type TransferenciaDetalle = {
  id: string;
  estado: "en_transito" | "recibida";
  fecha_despacho: string;
  fecha_recepcion: string | null;
  observaciones: string | null;
  transferencia_items: TransferenciaItemDetalle[];
};

export type PedidoDetalleData = {
  id: string;
  numero: string;
  estado: EstadoPedido;
  fecha_creacion: string;
  fecha_envio: string | null;
  fecha_cierre: string | null;
  motivo_cierre_manual: string | null;
  pedido_items: PedidoItemDetalle[];
  transferencias: TransferenciaDetalle[];
};

function nombreSku(sku: SkuInfo | null) {
  if (!sku) return "SKU eliminado";
  return sku.producto?.nombre ?? sku.nombre;
}

function presentacionSku(sku: SkuInfo | null) {
  if (!sku) return "";
  return [sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ");
}

const inputCelda =
  "w-[90px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe";

export function PedidoDetalle({
  pedido,
  puedeOrigen,
  puedeDestino,
  stockOrigen,
  disponibleOrigen,
}: {
  pedido: PedidoDetalleData;
  puedeOrigen: boolean;
  puedeDestino: boolean;
  stockOrigen: Record<string, number>;
  disponibleOrigen: Record<string, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mostrarDespacho, setMostrarDespacho] = useState(false);
  const [transferenciaARecibir, setTransferenciaARecibir] = useState<TransferenciaDetalle | null>(null);
  const [mostrarCierreManual, setMostrarCierreManual] = useState(false);

  const despachadoPorItem = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const t of pedido.transferencias) {
      for (const ti of t.transferencia_items) {
        mapa.set(ti.pedido_item_id, (mapa.get(ti.pedido_item_id) ?? 0) + ti.cantidad_despachada);
      }
    }
    return mapa;
  }, [pedido.transferencias]);

  const lineasPorDespachar: LineaPorDespachar[] = pedido.pedido_items
    .map((i) => {
      const disponible = (i.cantidad_preparada ?? 0) - (despachadoPorItem.get(i.id) ?? 0);
      return {
        pedido_item_id: i.id,
        nombre: nombreSku(i.sku),
        presentacion: presentacionSku(i.sku),
        disponible,
      };
    })
    .filter((l) => l.disponible > 0);

  function ejecutar(accion: () => Promise<{ error: string } | { ok: true }>) {
    setError(null);
    startTransition(async () => {
      const resultado = await accion();
      if ("error" in resultado) setError(resultado.error);
    });
  }

  function onGuardarAvance(pedidoItemId: string, cantidad: number) {
    ejecutar(() => guardarAvancePreparacion(pedido.id, [{ pedido_item_id: pedidoItemId, cantidad }]));
  }

  function onConfirmarPreparacion() {
    ejecutar(() => confirmarPreparacion(pedido.id));
  }

  function onEnviarPedido() {
    ejecutar(() => enviarPedido(pedido.id));
  }

  function onEliminarPedido() {
    if (!window.confirm("¿Eliminar este pedido en borrador? No se puede deshacer.")) return;
    startTransition(async () => {
      const resultado = await eliminarPedido(pedido.id);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push("/pedidos");
    });
  }

  const enPreparacion = pedido.estado === "enviado" || pedido.estado === "en_preparacion";
  const hayFaltaPreparar = pedido.pedido_items.some((i) => i.cantidad_preparada === null);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">{pedido.numero}</h2>
            <p className="mt-[2px] text-[12.5px] text-text-3">
              Creado {formatoFechaHora.format(new Date(pedido.fecha_creacion))}
              {pedido.fecha_envio ? ` · Enviado ${formatoFechaHora.format(new Date(pedido.fecha_envio))}` : ""}
              {pedido.fecha_cierre ? ` · Cerrado ${formatoFechaHora.format(new Date(pedido.fecha_cierre))}` : ""}
            </p>
          </div>
          <EstadoPedidoBadge estado={pedido.estado} />
        </div>

        {pedido.estado === "borrador" && puedeDestino && (
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onEliminarPedido}
              disabled={pending}
              className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-err hover:bg-err-bg disabled:opacity-60"
            >
              Eliminar pedido
            </button>
            <button
              type="button"
              onClick={onEnviarPedido}
              disabled={pending || pedido.pedido_items.length === 0}
              className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
            >
              Enviar pedido
            </button>
          </div>
        )}

        {pedido.estado === "preparado" && puedeOrigen && lineasPorDespachar.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setMostrarDespacho(true)}
              className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90"
            >
              Despachar
            </button>
          </div>
        )}

        {pedido.estado === "despachado" && puedeOrigen && (
          <div className="mt-4 flex justify-end gap-2">
            {lineasPorDespachar.length > 0 && (
              <button
                type="button"
                onClick={() => setMostrarDespacho(true)}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-text hover:bg-bg-2"
              >
                Despachar más
              </button>
            )}
            <button
              type="button"
              onClick={() => setMostrarCierreManual(true)}
              className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-text hover:bg-bg-2"
            >
              Cerrar pedido manualmente
            </button>
          </div>
        )}

        {pedido.motivo_cierre_manual && (
          <p className="mt-3 rounded-[6px] bg-warn-bg px-[10px] py-[7px] text-[12.5px] text-warn">
            Cierre manual: {pedido.motivo_cierre_manual}
          </p>
        )}

        {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="border-b border-border px-[14px] py-[11px]">
          <h3 className="text-[13px] font-semibold text-text">Productos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                  Producto
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                  Solicitado
                </th>
                {enPreparacion && puedeOrigen && (
                  <>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Stock Olavarría
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Disponible transferible
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Preparar
                    </th>
                  </>
                )}
                {!enPreparacion && pedido.estado !== "borrador" && (
                  <>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Preparado
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Pendiente
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {pedido.pedido_items.map((item) => (
                <tr key={item.id} className="border-b border-[#F1F1F3] last:border-b-0">
                  <td className="px-[14px] py-[9px] align-middle">
                    <p className="font-medium text-text">{nombreSku(item.sku)}</p>
                    <p className="text-[11.5px] text-text-3">{presentacionSku(item.sku)}</p>
                  </td>
                  <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                    {item.cantidad_solicitada}
                  </td>
                  {enPreparacion && puedeOrigen && (
                    <>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {stockOrigen[item.sku_id] ?? 0}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {disponibleOrigen[item.sku_id] ?? 0}
                      </td>
                      <td className="px-[14px] py-[9px] align-middle">
                        <input
                          type="number"
                          min={0}
                          defaultValue={item.cantidad_preparada ?? ""}
                          className={inputCelda}
                          onBlur={(e) => {
                            const valor = e.target.value === "" ? null : Number(e.target.value);
                            if (valor === null) return;
                            if (valor === item.cantidad_preparada) return;
                            onGuardarAvance(item.id, valor);
                          }}
                        />
                      </td>
                    </>
                  )}
                  {!enPreparacion && pedido.estado !== "borrador" && (
                    <>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {item.cantidad_preparada ?? "—"}
                      </td>
                      <td
                        className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
                          (item.cantidad_pendiente ?? 0) > 0 ? "font-medium text-warn" : "text-text-3"
                        }`}
                      >
                        {item.cantidad_pendiente ?? "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {enPreparacion && puedeOrigen && (
          <div className="flex items-center justify-between border-t border-border px-[14px] py-[10px]">
            <span className="text-[12.5px] text-text-3">
              {hayFaltaPreparar
                ? "Faltan cargar cantidades preparadas en algunas líneas."
                : "Todas las líneas tienen cantidad preparada cargada."}
            </span>
            {pedido.estado === "en_preparacion" && (
              <button
                type="button"
                onClick={onConfirmarPreparacion}
                disabled={pending}
                className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                Confirmar preparación
              </button>
            )}
          </div>
        )}
      </div>

      {pedido.transferencias.length > 0 && (
        <div className="overflow-hidden rounded-card border border-border bg-bg">
          <div className="border-b border-border px-[14px] py-[11px]">
            <h3 className="text-[13px] font-semibold text-text">Transferencias</h3>
          </div>
          <div className="flex flex-col">
            {pedido.transferencias.map((t) => (
              <div key={t.id} className="border-b border-[#F1F1F3] px-[14px] py-[10px] last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] text-text-2">
                    Despachada {formatoFechaHora.format(new Date(t.fecha_despacho))}
                    {t.fecha_recepcion
                      ? ` · Recibida ${formatoFechaHora.format(new Date(t.fecha_recepcion))}`
                      : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
                        t.estado === "recibida" ? "bg-ok-bg text-ok" : "bg-info-bg text-info"
                      }`}
                    >
                      {t.estado === "recibida" ? "Recibida" : "En tránsito"}
                    </span>
                    {t.estado === "en_transito" && puedeDestino && (
                      <button
                        type="button"
                        onClick={() => setTransferenciaARecibir(t)}
                        className="rounded-[6px] bg-moe px-[10px] py-[4px] text-[12px] font-medium text-white hover:bg-moe/90"
                      >
                        Recibir
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-[6px] flex flex-col gap-[3px]">
                  {t.transferencia_items.map((ti) => {
                    const item = pedido.pedido_items.find((i) => i.id === ti.pedido_item_id);
                    return (
                      <p key={ti.id} className="text-[12.5px] text-text-2">
                        {nombreSku(item?.sku ?? null)}: despachado {ti.cantidad_despachada}
                        {ti.cantidad_recibida !== null && `, recibido ${ti.cantidad_recibida}`}
                        {ti.diferencia != null && ti.diferencia !== 0 && (
                          <span className="text-warn">
                            {" "}
                            (diferencia {ti.diferencia > 0 ? "+" : ""}
                            {ti.diferencia}
                            {ti.motivo_diferencia ? ` — ${ti.motivo_diferencia}` : ""})
                          </span>
                        )}
                      </p>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mostrarDespacho && (
        <DespachoForm
          pedidoId={pedido.id}
          lineas={lineasPorDespachar}
          onClose={() => setMostrarDespacho(false)}
        />
      )}

      {transferenciaARecibir && (
        <RecepcionTransferenciaForm
          pedidoId={pedido.id}
          transferenciaId={transferenciaARecibir.id}
          lineas={
            transferenciaARecibir.transferencia_items.map((ti): LineaTransferenciaPendiente => {
              const item = pedido.pedido_items.find((i) => i.id === ti.pedido_item_id);
              return {
                transferencia_item_id: ti.id,
                nombre: nombreSku(item?.sku ?? null),
                presentacion: presentacionSku(item?.sku ?? null),
                cantidad_despachada: ti.cantidad_despachada,
              };
            })
          }
          onClose={() => setTransferenciaARecibir(null)}
        />
      )}

      {mostrarCierreManual && (
        <CierreManualForm pedidoId={pedido.id} onClose={() => setMostrarCierreManual(false)} />
      )}
    </div>
  );
}
