"use client";

import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  resolverTicketEfectivo,
  coincideFragmentos,
  type ComboDef,
  type PromoCantidadDef,
  type Tramo,
} from "@/lib/promociones";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { confirmarVenta, desarmarParaVenta, type LineaVenta } from "../actions";
import { formatoMoneda } from "../_lib/formato";

export type SkuPos = {
  id: string;
  nombre: string;
  marcaNombre: string | null;
  codigoInterno: string;
  codigoBarras: string | null;
  presentacion: SkuPresentacion;
  esRetornable: boolean;
  valorDeposito: number;
  // El SKU que se desarma EN este (ej. para la lata, el pack x6). Null si
  // nada se desarma en este SKU.
  padreDesarme: { id: string; cantidad: number } | null;
  stock: number;
  precioEfectivo: number | null;
  precioOtroMedio: number | null;
  origen: "excepcion" | "cascada" | "manual" | "recargo" | "sin_precio" | "sin_costo";
  bajoCostoEfectivo: boolean;
  vendidosUltimos30Dias: number;
};

export type ComboData = ComboDef;
export type PromoCantidadData = PromoCantidadDef;

type MedioPago = "efectivo" | "debito" | "credito" | "transferencia";

const MEDIOS: { id: MedioPago; label: string }[] = [
  { id: "efectivo", label: "Efectivo" },
  { id: "debito", label: "Débito" },
  { id: "credito", label: "Crédito" },
  { id: "transferencia", label: "Transferencia" },
];

const ORIGEN_LABEL: Record<Tramo["origen"], string> = {
  combo: "Promo combo",
  cantidad: "Promo cantidad",
  excepcion: "Precio excepción",
  cascada: "",
  manual: "",
  recargo: "",
  sin_precio: "Sin precio cargado",
  sin_costo: "Sin costo cargado",
};

function textoBusqueda(sku: SkuPos) {
  return `${sku.marcaNombre ?? ""} ${sku.nombre} ${presentacionLabel(sku.presentacion)}`;
}

export function PosClient({
  sucursalId,
  sucursalNombre,
  skus,
  combos,
  promosCantidad,
  cajaAbierta,
  cantidadTicketsHoy,
}: {
  sucursalId: string;
  sucursalNombre: string;
  skus: SkuPos[];
  combos: ComboData[];
  promosCantidad: PromoCantidadData[];
  cajaAbierta: boolean;
  cantidadTicketsHoy: number;
}) {
  const router = useRouter();
  const [lineas, setLineas] = useState<{ skuId: string; cantidad: number }[]>([]);
  const [envaseChecked, setEnvaseChecked] = useState<Record<string, boolean>>({});
  const [medioPago, setMedioPago] = useState<MedioPago | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [desarmandoSkuId, setDesarmandoSkuId] = useState<string | null>(null);
  // Confirmación visible de que la venta se registró: el ticket se limpia
  // solo (para arrancar el siguiente), así que sin esto no queda ningún
  // rastro en pantalla de que la venta anterior se guardó.
  const [ventaConfirmada, setVentaConfirmada] = useState<number | null>(null);
  const avisoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const skuPorId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const resultados = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const yaEnCarrito = new Set(lineas.map((l) => l.skuId));
    return skus
      .filter((s) => !yaEnCarrito.has(s.id))
      .filter((s) => coincideFragmentos(textoBusqueda(s), q))
      .slice(0, 8);
  }, [skus, lineas, query]);

  const accesos = useMemo(
    () =>
      [...skus]
        .filter((s) => s.vendidosUltimos30Dias > 0)
        .sort((a, b) => b.vendidosUltimos30Dias - a.vendidosUltimos30Dias)
        .slice(0, 10),
    [skus],
  );

  function obtenerBase(skuId: string) {
    const sku = skuPorId.get(skuId);
    return {
      precioEfectivo: sku?.precioEfectivo ?? null,
      origen: sku?.origen ?? "sin_precio",
      bajoCosto: sku?.bajoCostoEfectivo ?? false,
    };
  }

  const tramosPorSku = useMemo(
    () => resolverTicketEfectivo(lineas, combos, promosCantidad, obtenerBase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineas, combos, promosCantidad, skus],
  );

  let totalOtroMedio = 0;
  let totalEfectivo = 0;
  let depositoTotal = 0;
  for (const l of lineas) {
    const sku = skuPorId.get(l.skuId);
    if (!sku) continue;
    totalOtroMedio += (sku.precioOtroMedio ?? 0) * l.cantidad;
    if (sku.esRetornable && envaseChecked[l.skuId]) {
      depositoTotal += sku.valorDeposito * l.cantidad;
    }
  }
  for (const tramos of tramosPorSku.values()) {
    for (const t of tramos) totalEfectivo += t.precioUnitario * t.cantidad;
  }
  totalOtroMedio += depositoTotal;
  totalEfectivo += depositoTotal;

  const hayDescuento = Math.round(totalEfectivo) < Math.round(totalOtroMedio);
  const cantidadUnidades = lineas.reduce((acc, l) => acc + l.cantidad, 0);

  function agregarSku(sku: SkuPos, cantidad = 1) {
    if (ventaConfirmada != null) {
      if (avisoTimeoutRef.current) clearTimeout(avisoTimeoutRef.current);
      setVentaConfirmada(null);
    }
    setLineas((prev) => {
      const idx = prev.findIndex((l) => l.skuId === sku.id);
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + cantidad };
        return copia;
      }
      return [...prev, { skuId: sku.id, cantidad }];
    });
    if (sku.esRetornable) {
      setEnvaseChecked((prev) => (sku.id in prev ? prev : { ...prev, [sku.id]: true }));
    }
    setQuery("");
  }

  function ajustarCantidad(skuId: string, delta: number) {
    setLineas((prev) =>
      prev
        .map((l) => (l.skuId === skuId ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0),
    );
  }

  function quitarLinea(skuId: string) {
    setLineas((prev) => prev.filter((l) => l.skuId !== skuId));
  }

  function alternarEnvase(skuId: string) {
    setEnvaseChecked((prev) => ({ ...prev, [skuId]: !prev[skuId] }));
  }

  function onScanKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    const porCodigoBarras = skus.find((s) => s.codigoBarras === q);
    if (porCodigoBarras) {
      agregarSku(porCodigoBarras);
      return;
    }
    if (resultados.length === 1) {
      agregarSku(resultados[0]);
    }
  }

  // Cadena de desarme (arquitectura.md 1.3): sube hasta 2 niveles (pack x6,
  // pack x24) buscando de dónde sacar el faltante. Se encadena sola, el
  // encargado solo aprieta un botón.
  function sugerirDesarme(sku: SkuPos, faltante: number) {
    const padreInfo = sku.padreDesarme;
    if (!padreInfo) return null;
    const padre = skuPorId.get(padreInfo.id);
    if (!padre) return null;

    const necesitaPadre = Math.ceil(faltante / padreInfo.cantidad);

    if (padre.stock >= necesitaPadre) {
      return [{ skuId: padre.id, cantidad: necesitaPadre }];
    }

    const abueloInfo = padre.padreDesarme;
    if (!abueloInfo) return null;
    const abuelo = skuPorId.get(abueloInfo.id);
    if (!abuelo) return null;

    const padreFaltante = necesitaPadre - Math.max(padre.stock, 0);
    const necesitaAbuelo = Math.ceil(padreFaltante / abueloInfo.cantidad);
    if (abuelo.stock >= necesitaAbuelo) {
      return [
        { skuId: abuelo.id, cantidad: necesitaAbuelo },
        { skuId: padre.id, cantidad: necesitaPadre },
      ];
    }
    return null;
  }

  function desarmar(sku: SkuPos, faltante: number) {
    const cadena = sugerirDesarme(sku, faltante);
    if (!cadena) return;
    setDesarmandoSkuId(sku.id);
    startTransition(async () => {
      const resultado = await desarmarParaVenta(sucursalId, cadena);
      setDesarmandoSkuId(null);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  function construirLineasVenta(medio: MedioPago): LineaVenta[] {
    if (medio !== "efectivo") {
      return lineas.map((l) => {
        const sku = skuPorId.get(l.skuId);
        const precio = sku?.precioOtroMedio ?? 0;
        return {
          sku_id: l.skuId,
          cantidad: l.cantidad,
          precio_unitario: precio,
          precio_lista_unitario: precio,
          promocion_id: null,
          con_envase: Boolean(sku?.esRetornable && envaseChecked[l.skuId]),
        };
      });
    }

    const resultado: LineaVenta[] = [];
    for (const l of lineas) {
      const sku = skuPorId.get(l.skuId);
      if (!sku) continue;
      const tramos = tramosPorSku.get(l.skuId) ?? [];
      for (const t of tramos) {
        resultado.push({
          sku_id: l.skuId,
          cantidad: t.cantidad,
          precio_unitario: t.precioUnitario,
          precio_lista_unitario: sku.precioOtroMedio ?? t.precioUnitario,
          promocion_id: t.promocionId,
          con_envase: Boolean(sku.esRetornable && envaseChecked[l.skuId]),
        });
      }
    }
    return resultado;
  }

  function confirmar() {
    if (!cajaAbierta) {
      setError("La caja de hoy ya está cerrada.");
      return;
    }
    if (lineas.length === 0) {
      setError("El ticket no tiene productos.");
      return;
    }
    if (!medioPago) {
      setError("Elegí el medio de pago antes de cobrar.");
      return;
    }
    setError(null);
    const totalCobrado = medioPago === "efectivo" ? totalEfectivo : totalOtroMedio;
    startTransition(async () => {
      const resultado = await confirmarVenta(sucursalId, medioPago, construirLineasVenta(medioPago));
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      setLineas([]);
      setEnvaseChecked({});
      setMedioPago(null);

      if (avisoTimeoutRef.current) clearTimeout(avisoTimeoutRef.current);
      setVentaConfirmada(totalCobrado);
      avisoTimeoutRef.current = setTimeout(() => setVentaConfirmada(null), 5000);

      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_372px]">
      {/* ============ IZQUIERDA: búsqueda ============ */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[15px] font-semibold text-text">Vender — {sucursalNombre}</h1>
          <a
            href="/vender/caja"
            className="rounded-[6px] border border-border bg-bg px-[10px] py-[4px] text-[12px] font-medium text-text-2 hover:bg-bg-2"
          >
            Caja del día · {cantidadTicketsHoy} ventas
          </a>
        </div>

        {!cajaAbierta && (
          <div className="mb-3 rounded-[7px] border border-warn/30 bg-warn-bg px-[12px] py-[10px] text-[12.5px] text-warn">
            La caja de hoy ya está cerrada. No se pueden registrar más ventas hasta el próximo día.
          </div>
        )}

        <div className="relative mb-3">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onScanKeyDown}
            placeholder="Escaneá el código de barras o escribí el nombre…"
            className="w-full rounded-card border border-border bg-bg px-[14px] py-[11px] text-[14.5px] text-text outline-none focus:border-moe"
          />
          {resultados.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-bg shadow-sm">
              {resultados.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => agregarSku(s)}
                  className="flex w-full items-center justify-between border-b border-[#F1F1F3] px-[12px] py-[8px] text-left text-[13px] last:border-b-0 hover:bg-bg-2"
                >
                  <span>
                    <span className="font-medium text-text">{s.nombre}</span>
                    <span className="text-text-3">
                      {" "}
                      · {s.marcaNombre} — {presentacionLabel(s.presentacion)}
                    </span>
                  </span>
                  <span className="tabular-nums text-text-2">
                    {s.precioEfectivo != null ? formatoMoneda.format(s.precioEfectivo) : "sin precio"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {accesos.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {accesos.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => agregarSku(s)}
                className="rounded-card border border-border bg-bg p-[10px] text-left hover:border-border-strong hover:bg-bg-2"
              >
                <b className="block text-[12.5px] font-medium leading-tight text-text">{s.nombre}</b>
                <small className="tabular-nums text-[11.5px] text-text-3">
                  {s.precioEfectivo != null ? formatoMoneda.format(s.precioEfectivo) : "sin precio"}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ============ DERECHA: ticket ============ */}
      <div className="flex flex-col rounded-card border border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border px-[15px] py-[12px]">
          <h2 className="text-[13px] font-semibold text-text">Ticket</h2>
          <span className="text-[12px] text-text-3">
            {lineas.length === 0
              ? "Sin productos"
              : `${lineas.length} producto${lineas.length > 1 ? "s" : ""} · ${cantidadUnidades} unidad${cantidadUnidades > 1 ? "es" : ""}`}
          </span>
        </div>

        {ventaConfirmada != null && (
          <div className="mx-[15px] mt-[11px] flex items-center gap-2 rounded-[7px] bg-ok-bg px-[12px] py-[10px] text-[12.5px] font-medium text-ok">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-[15px] w-[15px] shrink-0"
            >
              <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            Venta registrada · {formatoMoneda.format(ventaConfirmada)}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {lineas.length === 0 ? (
            <div className="p-[40px_20px] text-center text-text-3">
              <p className="mb-1 text-[13.5px] font-medium text-text-2">Escaneá el primer producto</p>
              <p className="text-[12.5px]">Aparece acá con su precio y podés ajustar la cantidad.</p>
            </div>
          ) : (
            lineas.map((l) => {
              const sku = skuPorId.get(l.skuId);
              if (!sku) return null;
              const tramos = tramosPorSku.get(l.skuId) ?? [];
              const subtotal = tramos.reduce((acc, t) => acc + t.precioUnitario * t.cantidad, 0);
              const faltante = Math.max(0, l.cantidad - sku.stock);
              const sinStock = faltante > 0;
              const cadenaDesarme = sinStock ? sugerirDesarme(sku, faltante) : null;

              return (
                <div key={l.skuId} className="border-b border-[#F1F1F3] px-[15px] py-[10px]">
                  <div className="grid grid-cols-[1fr_auto] items-start gap-x-[10px] gap-y-[4px]">
                    <div className="text-[13.5px] font-medium leading-tight text-text">
                      {sku.nombre}
                      <small className="mt-[1px] block text-[11.5px] font-normal text-text-3">
                        {sku.marcaNombre} · {presentacionLabel(sku.presentacion)}
                      </small>
                    </div>
                    <div className="whitespace-nowrap text-right text-[13.5px] tabular-nums text-text">
                      {formatoMoneda.format(subtotal)}
                    </div>

                    <div className="col-span-2 mt-[3px] flex flex-wrap items-center gap-[7px]">
                      <button
                        type="button"
                        onClick={() => ajustarCantidad(l.skuId, -1)}
                        className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-border text-[13px] text-text-2 hover:bg-bg-2"
                      >
                        −
                      </button>
                      <span className="min-w-[20px] text-center text-[13px] font-medium tabular-nums">
                        {l.cantidad}
                      </span>
                      <button
                        type="button"
                        onClick={() => ajustarCantidad(l.skuId, 1)}
                        className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-border text-[13px] text-text-2 hover:bg-bg-2"
                      >
                        +
                      </button>

                      {sku.esRetornable && (
                        <label className="ml-1 flex items-center gap-1 text-[11.5px] text-text-2">
                          <input
                            type="checkbox"
                            checked={Boolean(envaseChecked[l.skuId])}
                            onChange={() => alternarEnvase(l.skuId)}
                          />
                          Con envase
                        </label>
                      )}

                      <button
                        type="button"
                        onClick={() => quitarLinea(l.skuId)}
                        className="ml-auto text-[11.5px] text-text-3 hover:text-err"
                      >
                        Quitar
                      </button>
                    </div>

                    {tramos.map((t, i) =>
                      t.origen === "combo" || t.origen === "cantidad" ? (
                        <span
                          key={i}
                          className="col-span-2 mt-[2px] inline-block w-fit rounded-[4px] bg-ok-bg px-[6px] py-[1.5px] text-[11px] font-medium text-ok"
                        >
                          {t.cantidad} × {t.promocionNombre ?? ORIGEN_LABEL[t.origen]}
                        </span>
                      ) : null,
                    )}

                    {tramos.some((t) => t.bajoCosto) && (
                      <span className="col-span-2 mt-[2px] inline-block w-fit rounded-[4px] bg-orange-bg px-[6px] py-[1.5px] text-[11px] font-medium text-orange">
                        Precio por debajo del costo
                      </span>
                    )}

                    {sinStock && (
                      <div className="col-span-2 mt-[4px] rounded-[6px] bg-warn-bg px-[9px] py-[7px] text-[11.5px] text-warn">
                        <p className="mb-1">
                          Quedan {Math.max(sku.stock, 0)} en el sistema, faltan {faltante}. Se puede vender
                          igual: queda marcado para revisar en el próximo conteo.
                        </p>
                        {cadenaDesarme && (
                          <button
                            type="button"
                            disabled={pending && desarmandoSkuId === sku.id}
                            onClick={() => desarmar(sku, faltante)}
                            className="rounded-[5px] border border-warn px-[9px] py-[3px] text-[11.5px] font-medium text-warn hover:bg-warn/10 disabled:opacity-60"
                          >
                            {desarmandoSkuId === sku.id ? "Desarmando…" : "Desarmar pack"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-border p-[14px_15px]">
          <div className="mb-2 grid grid-cols-4 gap-[7px]">
            {MEDIOS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMedioPago(m.id)}
                className={`rounded-card border px-[8px] py-[8px] text-left text-[12.5px] font-medium ${
                  medioPago === m.id
                    ? "border-moe bg-moe-soft text-moe"
                    : "border-border bg-bg text-text hover:bg-bg-2"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {depositoTotal > 0 && (
            <div className="mb-[5px] flex justify-between text-[13px] text-text-2">
              <span>Depósito de envases</span>
              <span className="tabular-nums">{formatoMoneda.format(depositoTotal)}</span>
            </div>
          )}

          {hayDescuento ? (
            <>
              <div className="mb-[5px] flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-text-2">Total en efectivo</span>
                <span className="text-[20px] font-semibold tabular-nums text-text">
                  {formatoMoneda.format(totalEfectivo)}
                </span>
              </div>
              <div className="mb-[9px] flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-text-2">Total en otro medio</span>
                <span className="text-[15px] font-medium tabular-nums text-text-2">
                  {formatoMoneda.format(totalOtroMedio)}
                </span>
              </div>
            </>
          ) : (
            <div className="mb-[9px] flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-text-2">Total</span>
              <span className="text-[22px] font-semibold tabular-nums text-text">
                {formatoMoneda.format(totalOtroMedio)}
              </span>
            </div>
          )}

          {error && <p className="mb-2 text-[12.5px] text-err">{error}</p>}

          <button
            type="button"
            disabled={pending || lineas.length === 0}
            onClick={confirmar}
            className="w-full rounded-[7px] bg-moe px-[11px] py-[11px] text-[14px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {medioPago
              ? `Cobrar ${formatoMoneda.format(medioPago === "efectivo" ? totalEfectivo : totalOtroMedio)} · ${MEDIOS.find((m) => m.id === medioPago)?.label}`
              : "Confirmar venta"}
          </button>
        </div>
      </div>
    </div>
  );
}
