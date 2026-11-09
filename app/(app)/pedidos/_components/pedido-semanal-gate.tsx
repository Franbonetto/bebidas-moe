"use client";

import { useCallback, useEffect, useState } from "react";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { obtenerSugerenciaPedido } from "../actions";
import { SugerenciaForm, type SugerenciaSku } from "./sugerencia-form";

// Puerta de PIN para TODA la pantalla, no solo para confirmar un guardado
// (pedido del usuario 2026-11-05: "hay datos sensibles"). A diferencia del
// resto de /pedidos, acá los datos no viajan al navegador hasta que el PIN
// se valida del lado del servidor -- obtenerSugerenciaPedido() recién trae
// la sugerencia y las ventas de Laprida después de eso.
export function PedidoSemanalGate() {
  const pedirPin = usePinOperaciones();
  const [estado, setEstado] = useState<"pidiendo" | "bloqueado" | "listo">("pidiendo");
  const [filas, setFilas] = useState<SugerenciaSku[]>([]);
  const [ultimoDespacho, setUltimoDespacho] = useState<string | null>(null);
  const [puedeDespachar, setPuedeDespachar] = useState(false);
  const [hoy, setHoy] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    setEstado("pidiendo");

    const pin = await pedirPin();
    if (!pin) {
      setEstado("bloqueado");
      return;
    }

    const resultado = await obtenerSugerenciaPedido(pin);
    if ("error" in resultado) {
      setError(resultado.error);
      setEstado("bloqueado");
      return;
    }

    setFilas(resultado.filas as unknown as SugerenciaSku[]);
    setUltimoDespacho(resultado.ultimoDespacho);
    setPuedeDespachar(resultado.puedeDespachar);
    setHoy(resultado.hoy);
    setEstado("listo");
  }, [pedirPin]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (estado === "pidiendo") {
    return (
      <div className="rounded-card border border-border bg-bg p-[24px] text-center text-[13px] text-text-3">
        Pidiendo el PIN…
      </div>
    );
  }

  if (estado === "bloqueado") {
    return (
      <div className="rounded-card border border-border bg-bg p-[24px] text-center">
        <p className="mb-[6px] text-[13.5px] font-semibold text-text">
          Esta pantalla necesita el PIN de operaciones
        </p>
        <p className="mb-[12px] text-[12.5px] text-text-3">
          Tiene las ventas y el stock de Laprida, pedido del dueño.
        </p>
        {error && <p className="mb-[12px] text-[12.5px] text-err">{error}</p>}
        <button
          type="button"
          onClick={cargar}
          className="rounded-[6px] bg-moe px-[14px] py-[8px] text-[13px] font-medium text-white hover:bg-moe/90"
        >
          Ingresar PIN
        </button>
      </div>
    );
  }

  return (
    <SugerenciaForm
      filas={filas}
      ultimoDespacho={ultimoDespacho}
      puedeDespachar={puedeDespachar}
      hoy={hoy}
    />
  );
}
