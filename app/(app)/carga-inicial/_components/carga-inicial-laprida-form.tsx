"use client";

import { useRef, useState } from "react";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { SkuPicker, type SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { stockActualSkuSucursal, guardarCargaInicialSimple } from "../actions";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";

const inputBase =
  "rounded-[8px] border border-border bg-bg px-[12px] py-[9px] text-[16px] text-text outline-none focus:border-moe";
const inputClass = `w-full ${inputBase}`;
const labelClass = "mb-[5px] block text-[12.5px] font-medium text-text-2";

type Cargado = {
  skuId: string;
  nombre: string;
  presentacion: string;
  cantidad: number;
};

// Carga inicial de Laprida: solo cuenta, sin costo ni precio -- el
// encargado de Laprida no los ve (CLAUDE.md, matriz de roles). Mismo
// criterio que la pantalla completa: la cantidad es el TOTAL contado en la
// sucursal, no un incremento, así que cargar dos veces el mismo producto
// corrige y no duplica.
export function CargaInicialLapridaForm({
  sucursalId,
  sucursalNombre,
  skus,
}: {
  sucursalId: string;
  sucursalNombre: string;
  skus: SkuCatalogo[];
}) {
  const [sku, setSku] = useState<SkuCatalogo | null>(null);
  const [stockActual, setStockActual] = useState<number | null>(null);
  const [cargandoStock, setCargandoStock] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargados, setCargados] = useState<Cargado[]>([]);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const pedirPin = usePinOperaciones();

  function enfocarBuscador() {
    const input = contenedorRef.current?.querySelector<HTMLInputElement>(
      '[data-testid="sku-picker-input"]',
    );
    input?.focus();
  }

  async function elegirSku(elegido: SkuCatalogo) {
    setSku(elegido);
    setStockActual(null);
    setCantidad("");
    setError(null);
    setCargandoStock(true);
    const resultado = await stockActualSkuSucursal(elegido.id, sucursalId);
    setCargandoStock(false);
    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }
    setStockActual(resultado.stockActual);
  }

  function limpiar() {
    setSku(null);
    setStockActual(null);
    setCantidad("");
    setError(null);
  }

  async function guardar() {
    if (!sku) return;
    const cantidadNum = Number(cantidad);
    if (cantidad === "" || !Number.isInteger(cantidadNum) || cantidadNum < 0) {
      setError("Escribí cuántas unidades contaste (0 o más, sin decimales).");
      return;
    }

    setError(null);
    const pin = await pedirPin();
    if (!pin) return;

    setGuardando(true);
    const resultado = await guardarCargaInicialSimple(sku.id, sucursalId, cantidadNum, pin);
    setGuardando(false);

    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }

    setCargados((prev) => [
      {
        skuId: sku.id,
        nombre: sku.producto?.nombre ?? sku.codigo_interno,
        presentacion: presentacionLabel(sku),
        cantidad: resultado.stock,
      },
      ...prev,
    ]);
    limpiar();
    enfocarBuscador();
  }

  const yaCargadoEnSesion = sku ? cargados.some((c) => c.skuId === sku.id) : false;

  return (
    <div ref={contenedorRef} className="mx-auto flex max-w-[560px] flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-[15px]">
        <h1 className="text-[15px] font-semibold text-text">Carga inicial de stock</h1>
        <p className="mt-[3px] text-[12.5px] leading-[1.5] text-text-3">
          De a un producto por vez. Contá todo lo que haya de ese producto en {sucursalNombre}
          —depósito y góndola juntos— y cargá el total. Si lo cargás dos veces, el segundo número
          corrige al primero: no se suma.
        </p>
      </div>

      <div className="rounded-card border border-border bg-bg p-[15px]">
        <label className={labelClass}>Producto</label>
        <SkuPicker skus={skus} excluirIds={new Set()} onSelect={elegirSku} />

        <p className="mt-2 text-[12px] text-text-3">Escaneá con la pistola o buscá por nombre.</p>

        {cargandoStock && <p className="mt-3 text-[12.5px] text-text-3">Buscando el producto…</p>}

        {sku && stockActual !== null && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-[14px] font-semibold text-text">
              {sku.producto?.nombre ?? sku.codigo_interno}
            </p>
            <p className="text-[12.5px] text-text-3">
              {[sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ")}
            </p>

            <div
              className={`mt-3 rounded-[6px] px-[10px] py-[8px] text-[12.5px] ${
                stockActual > 0 || yaCargadoEnSesion ? "bg-warn-bg text-warn" : "bg-bg-2 text-text-2"
              }`}
            >
              {stockActual > 0 || yaCargadoEnSesion ? (
                <>
                  Ojo: el sistema ya tiene <b>{stockActual}</b> de este producto en {sucursalNombre}.
                  Si ya lo contaste antes, lo que escribas ahora lo reemplaza.
                </>
              ) : (
                <>El sistema todavía no tiene stock de este producto acá.</>
              )}
            </div>

            <div className="mt-3">
              <label className={labelClass}>Cantidad contada (total en la sucursal) *</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                autoFocus
                className={`${inputClass} tabular-nums`}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </div>

            {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="flex-1 rounded-[8px] bg-moe px-[14px] py-[10px] text-[15px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Guardar y seguir"}
              </button>
              <button type="button" onClick={limpiar} className="text-[13px] text-text-3 hover:text-text">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!sku && error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}
      </div>

      {cargados.length > 0 && (
        <div className="overflow-hidden rounded-card border border-border bg-bg">
          <div className="flex items-center justify-between border-b border-border px-[14px] py-[10px]">
            <h2 className="text-[13px] font-semibold text-text">Cargados recién</h2>
            <span className="text-[12px] text-text-3">
              {cargados.length} producto{cargados.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-col">
            {cargados.slice(0, 15).map((c, i) => (
              <div
                key={`${c.skuId}:${i}`}
                className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[8px] last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-text">{c.nombre}</span>
                  <span className="block text-[11.5px] text-text-3">{c.presentacion}</span>
                </span>
                <span className="shrink-0 text-[14px] font-medium tabular-nums text-text">
                  {c.cantidad}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
