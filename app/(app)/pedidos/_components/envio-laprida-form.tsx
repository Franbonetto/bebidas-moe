"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { despacharDirecto, type LineaPedido } from "../actions";
import { SelectorRangoVendido, useRangoVendido, useVendidoInicial } from "./rango-vendido";
import type { SugerenciaSku } from "./sugerencia-form";

// Envío de Olavarría a Laprida (pedido del usuario 2026-11-09). Es una lista
// de lo que Laprida vendió en el rango elegido, con cuánto le queda a ella y
// cuánto hay en Olavarría; al tocar un producto, un modal pregunta cuántas
// unidades se mandan. Nada de sugerido/objetivo/arrastre: acá se decide
// mirando la venta real y los dos stocks.

const thBase =
  "whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2";

function nombreProducto(f: SugerenciaSku) {
  return f.sku.producto?.nombre ?? f.sku.codigo_interno;
}

function subtituloProducto(f: SugerenciaSku) {
  return [f.sku.producto?.marca?.nombre, presentacionLabel(f.sku)].filter(Boolean).join(" — ");
}

export function EnvioLapridaForm({
  filas,
  ultimoDespacho,
  hoy,
}: {
  filas: SugerenciaSku[];
  ultimoDespacho: string | null;
  hoy: string;
}) {
  const router = useRouter();
  const pedirPin = usePinOperaciones();
  const [query, setQuery] = useState("");
  const [verTodos, setVerTodos] = useState(false);

  const vendidoInicial = useVendidoInicial(filas);
  const rango = useRangoVendido({ vendidoInicial, ultimoDespacho, hoy });
  const vendido = rango.vendido;

  // Cuánto se manda de cada producto (se completa desde el modal).
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [modalSku, setModalSku] = useState<SugerenciaSku | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function coincide(f: SugerenciaSku, q: string) {
    const producto = f.sku.producto?.nombre.toLowerCase() ?? "";
    const marca = f.sku.producto?.marca?.nombre.toLowerCase() ?? "";
    return producto.includes(q) || marca.includes(q) || f.sku.codigo_interno.toLowerCase().includes(q);
  }

  // Lo vendido en el rango, más lo que ya tiene cantidad cargada (aunque al
  // cambiar de rango haya dejado de aparecer como vendido, para que no quede
  // un envío "escondido").
  const vendidos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filas.filter(
      (f) =>
        ((vendido[f.sku_id] ?? 0) > 0 || (cantidades[f.sku_id] ?? 0) > 0) &&
        (!q || coincide(f, q)),
    );
  }, [filas, vendido, cantidades, query]);

  const otros = useMemo(() => {
    if (!verTodos) return [];
    const q = query.trim().toLowerCase();
    return filas.filter(
      (f) =>
        !((vendido[f.sku_id] ?? 0) > 0 || (cantidades[f.sku_id] ?? 0) > 0) &&
        (!q || coincide(f, q)),
    );
  }, [filas, vendido, cantidades, query, verTodos]);

  const lineasAEnviar = filas.filter((f) => (cantidades[f.sku_id] ?? 0) > 0);
  const totalUnidades = lineasAEnviar.reduce((acc, f) => acc + (cantidades[f.sku_id] ?? 0), 0);

  function guardarCantidad(f: SugerenciaSku, cantidad: number) {
    setCantidades((prev) => {
      const siguiente = { ...prev };
      if (cantidad > 0) siguiente[f.sku_id] = cantidad;
      else delete siguiente[f.sku_id];
      return siguiente;
    });
    setError(null);
    setModalSku(null);
  }

  function renderFila(f: SugerenciaSku) {
    const aEnviar = cantidades[f.sku_id] ?? 0;
    return (
      <tr
        key={f.sku_id}
        onClick={() => setModalSku(f)}
        className="cursor-pointer border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]"
      >
        <td className="px-[14px] py-[9px] align-middle">
          <p className="font-medium text-text">{nombreProducto(f)}</p>
          <p className="text-[11.5px] text-text-3">{subtituloProducto(f)}</p>
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
          {vendido[f.sku_id] ?? 0}
        </td>
        <td
          className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
            f.stock_actual <= 0 ? "font-medium text-err" : "text-text-2"
          }`}
        >
          {f.stock_actual}
          {f.en_transito > 0 && (
            <span className="block text-[11px] font-normal text-info">+{f.en_transito} en camino</span>
          )}
        </td>
        <td
          className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
            f.stock_origen <= 0 ? "font-medium text-err" : "text-text-2"
          }`}
        >
          {f.stock_origen}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setModalSku(f);
            }}
            className={
              aEnviar > 0
                ? "rounded-[6px] bg-moe-soft px-[10px] py-[4px] text-[13px] font-semibold tabular-nums text-moe hover:bg-moe-soft/70"
                : "rounded-[6px] border border-border bg-bg px-[10px] py-[4px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
            }
          >
            {aEnviar > 0 ? `${aEnviar} a enviar` : "Cargar"}
          </button>
        </td>
      </tr>
    );
  }

  function enviar() {
    if (lineasAEnviar.length === 0) {
      setError("Todavía no cargaste cuántas enviar de ningún producto.");
      return;
    }

    const sinStock = lineasAEnviar.filter((f) => cantidades[f.sku_id] > f.stock_origen);
    if (sinStock.length > 0) {
      const nombres = sinStock
        .slice(0, 3)
        .map((f) => nombreProducto(f))
        .join(", ");
      setError(
        `En Olavarría no hay stock para enviar ${sinStock.length} producto${
          sinStock.length === 1 ? "" : "s"
        } (${nombres}${sinStock.length > 3 ? "…" : ""}). Bajá la cantidad.`,
      );
      return;
    }

    if (
      !window.confirm(
        `Se envían ${totalUnidades} unidades de ${lineasAEnviar.length} producto${
          lineasAEnviar.length === 1 ? "" : "s"
        } a Laprida y se descuentan ahora del stock de Olavarría. Laprida las suma cuando confirme la recepción. ¿Confirmás?`,
      )
    ) {
      return;
    }

    setError(null);
    const lineas: LineaPedido[] = lineasAEnviar.map((f) => ({
      sku_id: f.sku_id,
      cantidad: cantidades[f.sku_id],
      cantidad_sugerida_sistema: f.sugerido,
      observacion_encargado: null,
    }));

    startTransition(async () => {
      const pin = await pedirPin();
      if (!pin) return;
      const resultado = await despacharDirecto(lineas, null, pin);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push(`/pedidos/${resultado.id}`);
    });
  }

  const sinVendidos = vendidos.length === 0 && otros.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-4 text-[12.5px] text-text-2">
        Elegí las fechas y mirá lo que Laprida vendió, cuánto le queda a ella y cuánto tenés vos en
        Olavarría. Tocá un producto para cargar cuántas enviás. Cuando termines, "Enviar a Laprida"
        descuenta tu stock ahora; Laprida lo suma cuando confirma que lo recibió.
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
          <h2 className="text-[13px] font-semibold text-text">Envío a Laprida</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-[6px] text-[12.5px] text-text-2">
              <input
                type="checkbox"
                checked={verTodos}
                onChange={(e) => setVerTodos(e.target.checked)}
                className="accent-[#C8201A]"
              />
              Ver también lo que no se vendió
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por producto, marca o código…"
              className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
            />
          </div>
        </div>

        <SelectorRangoVendido rango={rango} />

        {sinVendidos ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">
              {query.trim() ? "No encontramos productos" : "Laprida no vendió nada en este período"}
            </p>
            <p className="text-[12.5px] text-text-3">
              {query.trim()
                ? "Probá con otra marca, producto o código."
                : "Probá con otras fechas, o marcá \"Ver también lo que no se vendió\" para cargar cualquier producto."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Producto
                  </th>
                  <th className={thBase} title={rango.titulo}>
                    Vendió
                  </th>
                  <th className={thBase} title="Lo que le queda hoy en Laprida">
                    Le queda en Laprida
                  </th>
                  <th className={thBase} title="Lo que hay hoy en Olavarría">
                    Hay en Olavarría
                  </th>
                  <th className={thBase}>¿Cuántas enviás?</th>
                </tr>
              </thead>
              <tbody>
                {vendidos.map((f) => renderFila(f))}

                {otros.length > 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="border-b border-border bg-bg-2 px-[14px] py-[6px] text-[11.5px] font-medium text-text-2"
                    >
                      No se vendieron en este período
                    </td>
                  </tr>
                )}
                {otros.map((f) => renderFila(f))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-[14px] py-[10px]">
          <span className="text-[12.5px] text-text-2">
            {lineasAEnviar.length} producto{lineasAEnviar.length === 1 ? "" : "s"} ·{" "}
            <b className="text-text">{totalUnidades} unidades</b> para enviar
          </span>
          <button
            type="button"
            onClick={enviar}
            disabled={pending || lineasAEnviar.length === 0}
            className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {pending ? "Enviando…" : "Enviar a Laprida"}
          </button>
        </div>

        {error && <p className="border-t border-border px-[14px] py-[8px] text-[12.5px] text-err">{error}</p>}
      </div>

      {modalSku && (
        <ModalCantidad
          key={modalSku.sku_id}
          f={modalSku}
          vendido={vendido[modalSku.sku_id] ?? 0}
          tituloVendido={rango.titulo}
          actual={cantidades[modalSku.sku_id] ?? 0}
          onGuardar={(n) => guardarCantidad(modalSku, n)}
          onCancelar={() => setModalSku(null)}
        />
      )}
    </div>
  );
}

function ModalCantidad({
  f,
  vendido,
  tituloVendido,
  actual,
  onGuardar,
  onCancelar,
}: {
  f: SugerenciaSku;
  vendido: number;
  tituloVendido: string;
  actual: number;
  onGuardar: (cantidad: number) => void;
  onCancelar: () => void;
}) {
  const [valor, setValor] = useState(actual > 0 ? String(actual) : "");

  const texto = valor.trim();
  const numero = texto === "" ? 0 : Number(texto);
  const esEntero = Number.isInteger(numero) && numero >= 0;
  const excede = esEntero && numero > f.stock_origen;
  const puedeGuardar = esEntero && !excede;

  function guardar() {
    if (puedeGuardar) onGuardar(numero);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancelar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Cuántas enviar de ${nombreProducto(f)}`}
        className="w-[360px] max-w-full rounded-card border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15.5px] font-semibold text-text">{nombreProducto(f)}</h2>
        <p className="mb-3 text-[12.5px] text-text-3">{subtituloProducto(f)}</p>

        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-[8px] bg-bg-2 px-[8px] py-[8px]" title={tituloVendido}>
            <p className="text-[11px] text-text-3">Vendió</p>
            <p className="text-[18px] font-semibold tabular-nums text-text">{vendido}</p>
          </div>
          <div className="rounded-[8px] bg-bg-2 px-[8px] py-[8px]">
            <p className="text-[11px] text-text-3">Le queda a Laprida</p>
            <p
              className={`text-[18px] font-semibold tabular-nums ${
                f.stock_actual <= 0 ? "text-err" : "text-text"
              }`}
            >
              {f.stock_actual}
            </p>
            {f.en_transito > 0 && <p className="text-[11px] text-info">+{f.en_transito} en camino</p>}
          </div>
          <div className="rounded-[8px] bg-bg-2 px-[8px] py-[8px]">
            <p className="text-[11px] text-text-3">Hay en Olavarría</p>
            <p
              className={`text-[18px] font-semibold tabular-nums ${
                f.stock_origen <= 0 ? "text-err" : "text-text"
              }`}
            >
              {f.stock_origen}
            </p>
          </div>
        </div>

        <label className="mb-1 block text-[13px] font-medium text-text" htmlFor="cantidad-envio">
          ¿Cuántas enviás a Laprida?
        </label>
        <input
          id="cantidad-envio"
          type="number"
          inputMode="numeric"
          min={0}
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              guardar();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancelar();
            }
          }}
          placeholder="0"
          className={`w-full rounded-[6px] border bg-bg px-[10px] py-[8px] text-center text-[20px] font-semibold tabular-nums text-text outline-none focus:border-moe ${
            excede ? "border-err" : "border-border"
          }`}
        />

        {excede && (
          <p className="mt-2 text-[12.5px] text-err">
            En Olavarría hay {f.stock_origen}: no alcanza para enviar {numero}.
          </p>
        )}
        {!esEntero && texto !== "" && (
          <p className="mt-2 text-[12.5px] text-err">Poné un número entero, sin decimales.</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[14px] font-medium text-text-2 hover:bg-bg-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!puedeGuardar}
            className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[14px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {numero > 0 ? "Agregar al envío" : actual > 0 ? "Quitar del envío" : "Listo"}
          </button>
        </div>
      </div>
    </div>
  );
}
