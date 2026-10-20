"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { facturarVenta, guardarCliente, type Cliente } from "../../actions";
import { errorDeCuit, formatearCuit, soloDigitos } from "@/lib/cuit";

export type CondicionIvaOption = { id: string; nombre: string };

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const tipoBtnClass = (activo: boolean) =>
  `rounded-[6px] border px-[14px] py-[6px] text-[13px] font-medium ${
    activo ? "border-moe bg-moe-soft text-moe" : "border-border bg-bg text-text-2 hover:bg-bg-2"
  }`;

function buscarConsumidorFinal(condiciones: CondicionIvaOption[]): string {
  return condiciones.find((c) => c.nombre.toLowerCase().includes("consumidor final"))?.id ?? condiciones[0].id;
}

function buscarResponsableInscripto(condiciones: CondicionIvaOption[]): string {
  return condiciones.find((c) => c.nombre.toLowerCase().includes("responsable inscripto"))?.id ?? condiciones[0].id;
}

// ARCA rechaza Factura A con "Consumidor Final" (10243: condición de IVA no
// válida para esa clase de comprobante) -- esa condición es exclusiva de
// comprobantes B/C. Se saca de la lista cuando el tipo es A en vez de dejar
// que el usuario elija una combinación que ARCA va a rechazar seguro.
function condicionesParaTipo(condiciones: CondicionIvaOption[], tipoCbte: "A" | "B"): CondicionIvaOption[] {
  if (tipoCbte === "B") return condiciones;
  return condiciones.filter((c) => !c.nombre.toLowerCase().includes("consumidor final"));
}

export function FacturarForm({
  ventaId,
  condiciones,
  clientes,
}: {
  ventaId: string;
  condiciones: CondicionIvaOption[];
  clientes: Cliente[];
}) {
  const router = useRouter();
  const [tipoCbte, setTipoCbte] = useState<"A" | "B">("B");
  const [condicionIvaReceptorId, setCondicionIvaReceptorId] = useState(() => buscarConsumidorFinal(condiciones));
  const [cuitReceptor, setCuitReceptor] = useState("");
  const [razonSocialReceptor, setRazonSocialReceptor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Libreta de clientes (2026-10-20). La vendedora tipea parte del nombre
  // o del CUIT y elige; antes había que acertar el CUIT completo de
  // memoria para que se autocompletara algo.
  const [busqueda, setBusqueda] = useState("");
  const [mensajeCliente, setMensajeCliente] = useState<string | null>(null);
  const [pendingCliente, startTransitionCliente] = useTransition();

  const condicionesDisponibles = condicionesParaTipo(condiciones, tipoCbte);

  const coincidencias = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return [];
    const digitos = soloDigitos(texto);
    return clientes
      .filter(
        (c) =>
          c.razonSocial.toLowerCase().includes(texto) ||
          (digitos.length > 0 && c.cuit.includes(digitos)),
      )
      .slice(0, 6);
  }, [busqueda, clientes]);

  function elegirCliente(cliente: Cliente) {
    setCuitReceptor(cliente.cuit);
    setRazonSocialReceptor(cliente.razonSocial);
    // La condición guardada del cliente solo se aplica si es válida para
    // el tipo de comprobante elegido: un cliente con "Consumidor Final"
    // no puede usar esa condición en una Factura A (ARCA la rechaza).
    if (condicionesParaTipo(condiciones, tipoCbte).some((c) => c.id === cliente.condicionIvaId)) {
      setCondicionIvaReceptorId(cliente.condicionIvaId);
    }
    setBusqueda("");
    setMensajeCliente(null);
    setError(null);
  }

  function guardarEnLibreta() {
    const problema = errorDeCuit(cuitReceptor);
    if (problema) {
      setMensajeCliente(problema);
      return;
    }
    if (!razonSocialReceptor.trim()) {
      setMensajeCliente("Falta la razón social.");
      return;
    }

    startTransitionCliente(async () => {
      const resultado = await guardarCliente({
        cuit: cuitReceptor,
        razonSocial: razonSocialReceptor,
        condicionIvaId: condicionIvaReceptorId,
      });
      setMensajeCliente("error" in resultado ? resultado.error : "Cliente guardado.");
      if (!("error" in resultado)) router.refresh();
    });
  }

  function elegirTipo(nuevoTipo: "A" | "B") {
    setTipoCbte(nuevoTipo);
    const opciones = condicionesParaTipo(condiciones, nuevoTipo);
    if (!opciones.some((c) => c.id === condicionIvaReceptorId)) {
      setCondicionIvaReceptorId(
        nuevoTipo === "A" ? buscarResponsableInscripto(opciones) : buscarConsumidorFinal(condiciones),
      );
    }
  }

  function facturar() {
    if (tipoCbte === "A" && (!cuitReceptor.trim() || !razonSocialReceptor.trim())) {
      setError("Factura A necesita CUIT y razón social del receptor.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const resultado = await facturarVenta(ventaId, {
        tipoCbte,
        condicionIvaReceptorId,
        cuitReceptor: cuitReceptor.trim() || null,
        razonSocialReceptor: razonSocialReceptor.trim() || null,
      });

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-[12px] font-medium text-text-2">Tipo de comprobante</label>
        <div className="flex gap-2">
          <button type="button" className={tipoBtnClass(tipoCbte === "B")} onClick={() => elegirTipo("B")}>
            Factura B
          </button>
          <button type="button" className={tipoBtnClass(tipoCbte === "A")} onClick={() => elegirTipo("A")}>
            Factura A
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-medium text-text-2">Condición de IVA del receptor</label>
        <select
          value={condicionIvaReceptorId}
          onChange={(e) => setCondicionIvaReceptorId(e.target.value)}
          className={inputClass}
        >
          {condicionesDisponibles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-[7px] border border-border bg-bg-2 p-[11px]">
        <div className="mb-[7px] flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-medium text-text-2">
            {tipoCbte === "A" ? "Cliente" : "Cliente (opcional)"}
          </span>
          {tipoCbte === "B" && (
            <span className="text-[11.5px] text-text-3">
              Si no lo pide, dejalo vacío: va como Consumidor Final
            </span>
          )}
        </div>

        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o CUIT…"
          className={inputClass}
        />

        {busqueda.trim() !== "" && (
          <div className="mt-[6px] overflow-hidden rounded-[6px] border border-border bg-bg">
            {coincidencias.length > 0 ? (
              coincidencias.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegirCliente(c)}
                  className="flex w-full items-baseline justify-between gap-3 border-b border-border px-[10px] py-[7px] text-left last:border-b-0 hover:bg-bg-2"
                >
                  <span className="text-[13px] text-text">{c.razonSocial}</span>
                  <span className="text-[12px] tabular-nums text-text-3">{formatearCuit(c.cuit)}</span>
                </button>
              ))
            ) : (
              <p className="px-[10px] py-[7px] text-[12.5px] text-text-2">
                No hay ningún cliente guardado con ese nombre o CUIT. Cargalo abajo y queda guardado
                al facturar.
              </p>
            )}
          </div>
        )}

        <div className="mt-[9px] flex flex-col gap-[7px]">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">CUIT</label>
            <input
              type="text"
              inputMode="numeric"
              value={cuitReceptor}
              onChange={(e) => setCuitReceptor(e.target.value)}
              placeholder="Ej. 20304050607"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Razón social</label>
            <input
              type="text"
              value={razonSocialReceptor}
              onChange={(e) => setRazonSocialReceptor(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* Guardar a mano sirve para corregir un dato mal escrito de un
            cliente que ya está en la libreta -- al facturar se guarda
            solo, así que para un cliente nuevo este botón no hace falta. */}
        {(cuitReceptor.trim() !== "" || razonSocialReceptor.trim() !== "") && (
          <div className="mt-[8px] flex items-center justify-between gap-2">
            <span className="text-[12px] text-text-2">{mensajeCliente}</span>
            <button
              type="button"
              onClick={guardarEnLibreta}
              disabled={pendingCliente}
              className="shrink-0 rounded-[6px] border border-border bg-bg px-[10px] py-[5px] text-[12.5px] font-medium text-text-2 hover:bg-bg-2 disabled:opacity-60"
            >
              {pendingCliente ? "Guardando…" : "Guardar en la libreta"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-[12.5px] text-err">{error}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={facturar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Facturando…" : "Facturar"}
        </button>
      </div>
    </div>
  );
}
