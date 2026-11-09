"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { fechaOperativa } from "@/lib/fecha";
import {
  crearPedido,
  despacharDirecto,
  obtenerVendidoPorRango,
  type LineaPedido,
} from "../actions";

export type SugerenciaSku = {
  sku_id: string;
  stock_actual: number;
  en_transito: number;
  pendiente_pedidos_abiertos: number;
  stock_objetivo: number;
  arrastre: number;
  sugerido: number;
  vendido_desde_ultimo_envio: number;
  stock_origen: number;
  sku: SkuPresentacion & {
    codigo_interno: string;
    producto: { nombre: string; marca: { nombre: string } | null } | null;
  };
};

const formatoFecha = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

// "AAAA-MM-DD" -> "DD/MM" sin pasar por Date (evita correr el día por zona).
function formatoDia(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

const thBase =
  "whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2";

export function SugerenciaForm({
  filas,
  ultimoDespacho,
  puedeDespachar,
  hoy,
}: {
  filas: SugerenciaSku[];
  ultimoDespacho: string | null;
  // Solo la encargada de Olavarría puede mandar el envío directo.
  puedeDespachar: boolean;
  hoy: string;
}) {
  const router = useRouter();
  const pedirPin = usePinOperaciones();
  const [query, setQuery] = useState("");

  // "Vendido" en Laprida. Arranca como siempre (desde el último envío) y se
  // puede cambiar eligiendo un rango de días (pedido del usuario 2026-11-09).
  const desdeInicial = ultimoDespacho ? fechaOperativa(new Date(ultimoDespacho)) : "";
  const vendidoInicial = useMemo(
    () => Object.fromEntries(filas.map((f) => [f.sku_id, f.vendido_desde_ultimo_envio])),
    [filas],
  );
  const [vendido, setVendido] = useState<Record<string, number>>(vendidoInicial);
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hoy);
  const [rangoAplicado, setRangoAplicado] = useState<{ desde: string; hasta: string } | null>(null);
  const [cargandoRango, setCargandoRango] = useState(false);
  const [errorRango, setErrorRango] = useState<string | null>(null);

  const [cantidades, setCantidades] = useState<Record<string, number>>(
    Object.fromEntries(filas.map((f) => [f.sku_id, f.sugerido])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Arriba va todo lo que se vendió en el rango o que el sistema sugiere
  // reponer; abajo, el resto del catálogo.
  const conSugerencia = useMemo(
    () => filas.filter((f) => f.sugerido > 0 || (vendido[f.sku_id] ?? 0) > 0),
    [filas, vendido],
  );
  const restoDelCatalogo = useMemo(
    () => filas.filter((f) => !(f.sugerido > 0 || (vendido[f.sku_id] ?? 0) > 0)),
    [filas, vendido],
  );

  function coincide(f: SugerenciaSku, q: string) {
    const producto = f.sku.producto?.nombre.toLowerCase() ?? "";
    const marca = f.sku.producto?.marca?.nombre.toLowerCase() ?? "";
    return producto.includes(q) || marca.includes(q) || f.sku.codigo_interno.toLowerCase().includes(q);
  }

  const sugeridasFiltradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conSugerencia.filter((f) => coincide(f, q)) : conSugerencia;
  }, [conSugerencia, query]);

  const restoFiltrado = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? restoDelCatalogo.filter((f) => coincide(f, q)) : restoDelCatalogo;
  }, [restoDelCatalogo, query]);

  const sinResultados = sugeridasFiltradas.length === 0 && restoFiltrado.length === 0;

  const tituloVendido = rangoAplicado
    ? `Vendido en Laprida del ${formatoDia(rangoAplicado.desde)} al ${formatoDia(rangoAplicado.hasta)} (inclusive)`
    : ultimoDespacho
      ? `Vendido en Laprida desde el último envío (${formatoFecha.format(new Date(ultimoDespacho))})`
      : "Vendido en Laprida: todavía no se le despachó nada, es todo el historial";

  async function aplicarRango() {
    setErrorRango(null);
    if (!desde || !hasta) {
      setErrorRango("Elegí las dos fechas.");
      return;
    }
    if (desde > hasta) {
      setErrorRango('La fecha "desde" no puede ser posterior a "hasta".');
      return;
    }

    const pin = await pedirPin();
    if (!pin) return;

    setCargandoRango(true);
    const resultado = await obtenerVendidoPorRango(pin, desde, hasta);
    setCargandoRango(false);

    if ("error" in resultado) {
      setErrorRango(resultado.error);
      return;
    }
    setVendido(resultado.vendido);
    setRangoAplicado({ desde, hasta });
  }

  function volverAlUltimoEnvio() {
    setErrorRango(null);
    setVendido(vendidoInicial);
    setRangoAplicado(null);
    setDesde(desdeInicial);
    setHasta(hoy);
  }

  function excedeStockOrigen(f: SugerenciaSku) {
    return puedeDespachar && (cantidades[f.sku_id] ?? 0) > f.stock_origen;
  }

  function renderFila(f: SugerenciaSku) {
    return (
      <tr key={f.sku_id} className="border-b border-[#F1F1F3] last:border-b-0">
        <td className="px-[14px] py-[9px] align-middle">
          <p className="font-medium text-text">{f.sku.producto?.nombre}</p>
          <p className="text-[11.5px] text-text-3">
            {f.sku.producto?.marca?.nombre} — {presentacionLabel(f.sku)}
          </p>
        </td>
        <td
          className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
            f.stock_actual <= 0 ? "font-medium text-err" : "text-text-2"
          }`}
        >
          {f.stock_actual}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {vendido[f.sku_id] ?? 0}
        </td>
        <td
          className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
            f.stock_origen <= 0 ? "font-medium text-err" : "text-text-2"
          }`}
        >
          {f.stock_origen}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.stock_objetivo}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.en_transito}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.pendiente_pedidos_abiertos}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.arrastre}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.sugerido}
        </td>
        <td className="px-[14px] py-[9px] align-middle">
          <input
            type="number"
            min={0}
            className={`w-[80px] rounded-[6px] border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe ${
              excedeStockOrigen(f) ? "border-err text-err" : "border-border"
            }`}
            title={
              excedeStockOrigen(f)
                ? `En Olavarría hay ${f.stock_origen}: no alcanza para enviar esa cantidad`
                : undefined
            }
            value={cantidades[f.sku_id] ?? 0}
            onChange={(e) =>
              setCantidades((prev) => ({ ...prev, [f.sku_id]: Number(e.target.value) }))
            }
          />
        </td>
      </tr>
    );
  }

  const lineasAPedir = filas.filter((f) => (cantidades[f.sku_id] ?? 0) > 0);
  const totalUnidades = lineasAPedir.reduce((acc, f) => acc + (cantidades[f.sku_id] ?? 0), 0);

  function validarLineas(): boolean {
    if (lineasAPedir.length === 0) {
      setError("No hay ninguna cantidad cargada para pedir.");
      return false;
    }
    for (const f of lineasAPedir) {
      const cantidad = cantidades[f.sku_id];
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        setError("Las cantidades tienen que ser enteros mayores a cero.");
        return false;
      }
    }
    return true;
  }

  function armarLineas(): LineaPedido[] {
    return lineasAPedir.map((f) => ({
      sku_id: f.sku_id,
      cantidad: cantidades[f.sku_id],
      cantidad_sugerida_sistema: f.sugerido,
      observacion_encargado: null,
    }));
  }

  function guardar(enviar: boolean) {
    if (!validarLineas()) return;

    setError(null);
    const lineas = armarLineas();

    startTransition(async () => {
      const resultado = await crearPedido(lineas, enviar);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push(`/pedidos/${resultado.id}`);
    });
  }

  // Envío directo (2026-11-09): Olavarría manda lo cargado a Laprida ya
  // mismo. Descuenta el stock de Olavarría; el de Laprida sube cuando ella
  // confirma la recepción.
  function enviarALaprida() {
    if (!validarLineas()) return;

    const sinStock = lineasAPedir.filter((f) => cantidades[f.sku_id] > f.stock_origen);
    if (sinStock.length > 0) {
      const nombres = sinStock
        .slice(0, 3)
        .map((f) => f.sku.producto?.nombre ?? f.sku.codigo_interno)
        .join(", ");
      setError(
        `En Olavarría no hay stock para enviar ${sinStock.length} producto${
          sinStock.length === 1 ? "" : "s"
        } (${nombres}${sinStock.length > 3 ? "…" : ""}). Bajá la cantidad o dejala en 0.`,
      );
      return;
    }

    if (
      !window.confirm(
        `Se envían ${totalUnidades} unidades de ${lineasAPedir.length} producto${
          lineasAPedir.length === 1 ? "" : "s"
        } a Laprida y se descuentan ahora del stock de Olavarría. Laprida las suma cuando confirme la recepción. ¿Confirmás?`,
      )
    ) {
      return;
    }

    setError(null);
    const lineas = armarLineas();

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

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-4 text-[12.5px] text-text-2">
        Arriba están los {conSugerencia.length} producto{conSugerencia.length === 1 ? "" : "s"} que
        Laprida vendió en el período elegido o que el sistema sugiere reponer, precargados con la
        cantidad sugerida (descuenta lo que ya está en camino y lo pendiente de pedidos abiertos, y
        suma lo que quedó sin resolver del último pedido cerrado). Elegí las fechas de "Vendido"
        para ver lo que se vendió, por ejemplo de lunes a lunes, y completá la columna "Pedir".
        Debajo está el resto del catálogo. Podés cambiar cualquier cantidad antes de confirmar.
        {puedeDespachar &&
          ' "Enviar a Laprida" despacha ya mismo desde Olavarría: se descuenta tu stock y Laprida lo suma cuando confirma que lo recibió.'}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
          <h2 className="text-[13px] font-semibold text-text">Pedido semanal sugerido</h2>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por producto, marca o código…"
            className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-border bg-bg-2 px-[14px] py-[10px]">
          <label className="flex flex-col gap-[3px] text-[11.5px] font-medium text-text-2">
            Vendido desde
            <input
              type="date"
              value={desde}
              max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-[13px] text-text outline-none focus:border-moe"
            />
          </label>
          <label className="flex flex-col gap-[3px] text-[11.5px] font-medium text-text-2">
            Hasta (inclusive)
            <input
              type="date"
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-[13px] text-text outline-none focus:border-moe"
            />
          </label>
          <button
            type="button"
            onClick={aplicarRango}
            disabled={cargandoRango}
            className="rounded-[6px] border border-border bg-bg px-[12px] py-[5px] text-[13px] font-medium text-text hover:bg-bg-2 disabled:opacity-60"
          >
            {cargandoRango ? "Calculando…" : "Ver vendido"}
          </button>
          {rangoAplicado && (
            <button
              type="button"
              onClick={volverAlUltimoEnvio}
              className="px-[4px] py-[5px] text-[12.5px] font-medium text-moe hover:underline"
            >
              Volver a "desde el último envío"
            </button>
          )}
          <p className="pb-[6px] text-[12px] text-text-3">
            {rangoAplicado
              ? `Mostrando lo vendido del ${formatoDia(rangoAplicado.desde)} al ${formatoDia(rangoAplicado.hasta)}.`
              : ultimoDespacho
                ? `Mostrando lo vendido desde el último envío (${formatoFecha.format(new Date(ultimoDespacho))}).`
                : "Todavía no se le envió nada a Laprida: se muestra todo lo vendido."}
          </p>
          {errorRango && <p className="w-full text-[12.5px] text-err">{errorRango}</p>}
        </div>

        {filas.length === 0 ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">
              No hay productos en el catálogo
            </p>
            <p className="text-[12.5px] text-text-3">
              No hay SKU activos para pedir.
            </p>
          </div>
        ) : sinResultados ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">
              No encontramos productos
            </p>
            <p className="text-[12.5px] text-text-3">Probá con otra marca, producto o código.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Producto
                  </th>
                  <th className={thBase} title="Stock actual en Laprida">
                    Stock
                  </th>
                  <th className={thBase} title={tituloVendido}>
                    Vendido
                  </th>
                  <th className={thBase} title="Stock actual en Olavarría: lo máximo que se puede enviar">
                    Olavarría
                  </th>
                  <th className={thBase}>Objetivo</th>
                  <th className={thBase}>En camino</th>
                  <th className={thBase}>Pedidos abiertos</th>
                  <th className={thBase}>Arrastre</th>
                  <th className={thBase}>Sugerido</th>
                  <th className={thBase}>Pedir</th>
                </tr>
              </thead>
              <tbody>
                {sugeridasFiltradas.map((f) => renderFila(f))}

                {restoFiltrado.length > 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="border-b border-border bg-bg-2 px-[14px] py-[6px] text-[11.5px] font-medium text-text-2"
                    >
                      Resto del catálogo
                    </td>
                  </tr>
                )}
                {restoFiltrado.map((f) => renderFila(f))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-[14px] py-[10px]">
          <span className="text-[12.5px] text-text-2">
            {lineasAPedir.length} producto{lineasAPedir.length === 1 ? "" : "s"} ·{" "}
            <b className="text-text">{totalUnidades} unidades</b>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => guardar(false)}
              disabled={pending}
              className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2 disabled:opacity-60"
            >
              Guardar borrador
            </button>
            {/* Con el envío directo disponible, "Enviar pedido" (el pedido
                que Laprida le hace a Olavarría) pasa a secundario: el botón
                rojo es uno solo por pantalla. */}
            <button
              type="button"
              onClick={() => guardar(true)}
              disabled={pending}
              className={
                puedeDespachar
                  ? "rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2 disabled:opacity-60"
                  : "rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              }
            >
              Enviar pedido
            </button>
            {puedeDespachar && (
              <button
                type="button"
                onClick={enviarALaprida}
                disabled={pending}
                className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                Enviar a Laprida
              </button>
            )}
          </div>
        </div>

        {error && <p className="border-t border-border px-[14px] py-[8px] text-[12.5px] text-err">{error}</p>}
      </div>
    </div>
  );
}
