"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { facturarVenta, type ClienteFrecuente } from "../../actions";

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
  clientesFrecuentes,
}: {
  ventaId: string;
  condiciones: CondicionIvaOption[];
  clientesFrecuentes: ClienteFrecuente[];
}) {
  const router = useRouter();
  const [tipoCbte, setTipoCbte] = useState<"A" | "B">("B");
  const [condicionIvaReceptorId, setCondicionIvaReceptorId] = useState(() => buscarConsumidorFinal(condiciones));
  const [cuitReceptor, setCuitReceptor] = useState("");
  const [razonSocialReceptor, setRazonSocialReceptor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const condicionesDisponibles = condicionesParaTipo(condiciones, tipoCbte);

  // Autocompletar: si el CUIT tipeado coincide con uno ya facturado antes,
  // se completa la razón social sola -- así la vendedora no tiene que
  // volver a escribirla para un cliente habitual. No pisa un valor que la
  // vendedora ya haya escrito a mano para ese mismo CUIT.
  function cambiarCuit(valor: string) {
    setCuitReceptor(valor);
    const conocido = clientesFrecuentes.find((c) => c.cuit === valor.trim());
    if (conocido && !razonSocialReceptor.trim()) {
      setRazonSocialReceptor(conocido.razonSocial);
    }
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

      <datalist id="clientes-frecuentes-cuit">
        {clientesFrecuentes.map((c) => (
          <option key={c.cuit} value={c.cuit}>
            {c.razonSocial}
          </option>
        ))}
      </datalist>

      {tipoCbte === "A" ? (
        <>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">CUIT del receptor</label>
            <input
              type="text"
              list="clientes-frecuentes-cuit"
              value={cuitReceptor}
              onChange={(e) => cambiarCuit(e.target.value)}
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
        </>
      ) : (
        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-2">CUIT del receptor (opcional)</label>
          <input
            type="text"
            list="clientes-frecuentes-cuit"
            value={cuitReceptor}
            onChange={(e) => cambiarCuit(e.target.value)}
            placeholder="Consumidor Final — dejar vacío si no lo pide"
            className={inputClass}
          />
        </div>
      )}

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
