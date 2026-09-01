"use client";

import { useState, useTransition } from "react";
import {
  guardarPrecioBase,
  guardarOverride,
  eliminarOverride,
  marcarCascadaCerveza,
} from "../actions";
import type { PrecioSkuRow, Sucursal } from "./precios-table";
import { presentacionLabel } from "../../productos/_lib/presentacion";

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

export function PrecioSkuForm({
  sucursales,
  fila,
  onClose,
}: {
  sucursales: Sucursal[];
  fila: PrecioSkuRow;
  onClose: () => void;
}) {
  const [cascada, setCascada] = useState(fila.cascadaCervezaLata);
  const [precioBase, setPrecioBase] = useState(
    fila.precioBaseManual != null ? String(fila.precioBaseManual) : "",
  );
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const s of sucursales) {
      const precio = fila.porSucursal[s.id];
      inicial[s.id] = precio?.esExcepcion && precio.precioBase != null ? String(precio.precioBase) : "";
    }
    return inicial;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function guardar() {
    setError(null);
    startTransition(async () => {
      if (cascada !== fila.cascadaCervezaLata) {
        const resultado = await marcarCascadaCerveza(fila.id, cascada);
        if ("error" in resultado) {
          setError(resultado.error);
          return;
        }
      }

      if (!cascada) {
        const valor = precioBase.trim() === "" ? null : Number(precioBase);
        if (valor != null) {
          const resultado = await guardarPrecioBase(fila.id, valor);
          if ("error" in resultado) {
            setError(resultado.error);
            return;
          }
        }
      }

      for (const s of sucursales) {
        const esCentralSinCascada = s.es_central && !cascada;
        if (esCentralSinCascada) continue;

        const texto = overrides[s.id]?.trim() ?? "";
        const teniaOverride = fila.porSucursal[s.id]?.esExcepcion ?? false;

        if (texto === "") {
          if (teniaOverride) {
            const resultado = await eliminarOverride(s.id, fila.id);
            if ("error" in resultado) {
              setError(resultado.error);
              return;
            }
          }
          continue;
        }

        const resultado = await guardarOverride(s.id, fila.id, Number(texto));
        if ("error" in resultado) {
          setError(resultado.error);
          return;
        }
      }

      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-[480px] overflow-y-auto rounded-card border border-border bg-bg p-5">
        <h2 className="mb-1 text-[14px] font-semibold text-text">{fila.nombre}</h2>
        <p className="mb-4 text-[12px] text-text-3">{presentacionLabel(fila.presentacion)}</p>

        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input type="checkbox" checked={cascada} onChange={(e) => setCascada(e.target.checked)} />
            Participa de la cascada de cerveza en lata
          </label>
          <p className="-mt-2 text-[11.5px] text-text-3">
            Si está tildado, el precio de Olavarría y Laprida se calcula solo a partir del costo del
            pack x24 (no se carga a mano).
          </p>

          {!cascada && (
            <div>
              <label className={labelClass}>Precio base Olavarría</label>
              <input
                type="number"
                min={0}
                step="1"
                className={inputClass}
                value={precioBase}
                onChange={(e) => setPrecioBase(e.target.value)}
                placeholder="Sin precio cargado"
              />
            </div>
          )}

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-[12px] font-medium text-text-2">
              Excepción manual (pisa el precio calculado o el recargo)
            </p>
            {sucursales.map((s) => {
              const bloqueada = s.es_central && !cascada;
              return (
                <div key={s.id} className="mb-2">
                  <label className={labelClass}>{s.nombre}</label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    disabled={bloqueada}
                    className={`${inputClass} ${bloqueada ? "opacity-50" : ""}`}
                    value={overrides[s.id] ?? ""}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder={bloqueada ? "Editá el precio base directamente" : "Sin excepción"}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={pending}
            className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
