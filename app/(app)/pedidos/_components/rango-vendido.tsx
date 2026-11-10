"use client";

import { useMemo, useState } from "react";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { fechaOperativa } from "@/lib/fecha";
import { obtenerVendidoPorRango } from "../actions";

// Rango de fechas para ver lo que vendió Laprida (pedido del usuario
// 2026-11-09: "selecciona lunes a lunes y le aparece todo lo vendido").
// Arranca igual que siempre -- desde el último envío -- y se puede cambiar.
// Lo comparten el pedido semanal de Laprida y el envío de Olavarría.

const formatoFecha = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" });

// "AAAA-MM-DD" -> "DD/MM" sin pasar por Date (evita correr el día por zona).
export function formatoDia(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

export function useRangoVendido({
  vendidoInicial,
  ultimoDespacho,
  hoy,
}: {
  vendidoInicial: Record<string, number>;
  ultimoDespacho: string | null;
  hoy: string;
}) {
  const pedirPin = usePinOperaciones();

  const desdeInicial = ultimoDespacho ? fechaOperativa(new Date(ultimoDespacho)) : "";
  const [vendido, setVendido] = useState<Record<string, number>>(vendidoInicial);
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hoy);
  const [rangoAplicado, setRangoAplicado] = useState<{ desde: string; hasta: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titulo = rangoAplicado
    ? `Vendido en Laprida del ${formatoDia(rangoAplicado.desde)} al ${formatoDia(rangoAplicado.hasta)} (inclusive)`
    : ultimoDespacho
      ? `Vendido en Laprida desde el último envío (${formatoFecha.format(new Date(ultimoDespacho))})`
      : "Vendido en Laprida: todavía no se le despachó nada, es todo el historial";

  const leyenda = rangoAplicado
    ? `Mostrando lo vendido del ${formatoDia(rangoAplicado.desde)} al ${formatoDia(rangoAplicado.hasta)}.`
    : ultimoDespacho
      ? `Mostrando lo vendido desde el último envío (${formatoFecha.format(new Date(ultimoDespacho))}).`
      : "Todavía no se le envió nada a Laprida: se muestra todo lo vendido.";

  async function aplicar() {
    setError(null);
    if (!desde || !hasta) {
      setError("Elegí las dos fechas.");
      return;
    }
    if (desde > hasta) {
      setError('La fecha "desde" no puede ser posterior a "hasta".');
      return;
    }

    const pin = await pedirPin();
    if (!pin) return;

    setCargando(true);
    const resultado = await obtenerVendidoPorRango(pin, desde, hasta);
    setCargando(false);

    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }
    setVendido(resultado.vendido);
    setRangoAplicado({ desde, hasta });
  }

  function volver() {
    setError(null);
    setVendido(vendidoInicial);
    setRangoAplicado(null);
    setDesde(desdeInicial);
    setHasta(hoy);
  }

  return {
    vendido,
    desde,
    setDesde,
    hasta,
    setHasta,
    rangoAplicado,
    cargando,
    error,
    titulo,
    leyenda,
    aplicar,
    volver,
  };
}

export type RangoVendido = ReturnType<typeof useRangoVendido>;

// Lo mínimo que necesita la barra de fechas: así también la usa el pedido de
// compra de Olavarría, que arma su propio estado.
export type RangoControl = Pick<
  RangoVendido,
  "desde" | "setDesde" | "hasta" | "setHasta" | "rangoAplicado" | "cargando" | "error" | "leyenda" | "aplicar" | "volver"
>;

export function SelectorRangoVendido({
  rango,
  etiquetaDesde = "Vendido desde",
  textoVolver = 'Volver a "desde el último envío"',
}: {
  rango: RangoControl;
  etiquetaDesde?: string;
  textoVolver?: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border bg-bg-2 px-[14px] py-[10px]">
      <label className="flex flex-col gap-[3px] text-[11.5px] font-medium text-text-2">
        {etiquetaDesde}
        <input
          type="date"
          value={rango.desde}
          max={rango.hasta || undefined}
          onChange={(e) => rango.setDesde(e.target.value)}
          className="rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-[13px] text-text outline-none focus:border-moe"
        />
      </label>
      <label className="flex flex-col gap-[3px] text-[11.5px] font-medium text-text-2">
        Hasta (inclusive)
        <input
          type="date"
          value={rango.hasta}
          min={rango.desde || undefined}
          onChange={(e) => rango.setHasta(e.target.value)}
          className="rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-[13px] text-text outline-none focus:border-moe"
        />
      </label>
      <button
        type="button"
        onClick={rango.aplicar}
        disabled={rango.cargando}
        className="rounded-[6px] border border-border bg-bg px-[12px] py-[5px] text-[13px] font-medium text-text hover:bg-bg-2 disabled:opacity-60"
      >
        {rango.cargando ? "Calculando…" : "Ver vendido"}
      </button>
      {rango.rangoAplicado && (
        <button
          type="button"
          onClick={rango.volver}
          className="px-[4px] py-[5px] text-[12.5px] font-medium text-moe hover:underline"
        >
          {textoVolver}
        </button>
      )}
      <p className="pb-[6px] text-[12px] text-text-3">{rango.leyenda}</p>
      {rango.error && <p className="w-full text-[12.5px] text-err">{rango.error}</p>}
    </div>
  );
}

// Para memoizar el mapa inicial sin repetir el Object.fromEntries en cada form.
export function useVendidoInicial(
  filas: { sku_id: string; vendido_desde_ultimo_envio: number }[],
): Record<string, number> {
  return useMemo(
    () => Object.fromEntries(filas.map((f) => [f.sku_id, f.vendido_desde_ultimo_envio])),
    [filas],
  );
}
