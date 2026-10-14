"use client";

import { useState, useTransition } from "react";
import {
  guardarPrecioBase,
  guardarOverride,
  eliminarOverride,
  guardarPrecioEfectivo,
  eliminarPrecioEfectivo,
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
  // Precio en efectivo por sucursal (monto fijo, no un porcentaje). Se
  // precarga solo si el SKU tiene uno propio: si el número que se ve viene
  // del descuento de la categoría, el campo arranca vacío para no
  // convertirlo en fijo sin querer al guardar.
  const [efectivos, setEfectivos] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const s of sucursales) {
      const precio = fila.porSucursal[s.id];
      inicial[s.id] =
        precio?.efectivoEsPropio && precio.precioEfectivo != null
          ? String(precio.precioEfectivo)
          : "";
    }
    return inicial;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // El precio en efectivo no puede pasar al de lista: confirmar_venta()
  // rechaza toda línea con precio_unitario > precio_lista_unitario, así que
  // un efectivo más alto no se cobra más caro -- deja al producto sin poder
  // venderse. Se compara contra lo que hay en pantalla; si el precio base
  // cambió en este mismo guardado, el de la sucursal satélite puede estar
  // un paso atrás, y ahí la última red es el chequeo de la base.
  function errorEfectivoSobreLista(): string | null {
    for (const s of sucursales) {
      const texto = efectivos[s.id]?.trim() ?? "";
      if (texto === "") continue;

      const tipeado = s.es_central ? precioBase.trim() : (overrides[s.id]?.trim() ?? "");
      const lista =
        tipeado !== "" ? Number(tipeado) : (fila.porSucursal[s.id]?.precioOtroMedio ?? null);

      if (lista != null && Number(texto) > lista + 0.005) {
        return `El precio en efectivo de ${s.nombre} no puede ser mayor al de lista (${lista}): el POS no deja cerrar una venta por encima del precio de lista.`;
      }
    }
    return null;
  }

  function guardar() {
    setError(null);

    const errorLista = errorEfectivoSobreLista();
    if (errorLista) {
      setError(errorLista);
      return;
    }

    startTransition(async () => {
      const valor = precioBase.trim() === "" ? null : Number(precioBase);
      if (valor != null) {
        const resultado = await guardarPrecioBase(fila.id, valor);
        if ("error" in resultado) {
          setError(resultado.error);
          return;
        }
      }

      for (const s of sucursales) {
        if (s.es_central) continue; // Olavarría edita directo el precio base, sin excepción aparte.

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

      // El precio en efectivo sí va por sucursal en las dos, Olavarría
      // incluida: es el precio final de esa sucursal pagando en efectivo,
      // no una excepción sobre el precio base.
      for (const s of sucursales) {
        const texto = efectivos[s.id]?.trim() ?? "";
        const teniaPropio = fila.porSucursal[s.id]?.efectivoEsPropio ?? false;

        if (texto === "") {
          if (teniaPropio) {
            const resultado = await eliminarPrecioEfectivo(s.id, fila.id);
            if ("error" in resultado) {
              setError(resultado.error);
              return;
            }
          }
          continue;
        }

        const resultado = await guardarPrecioEfectivo(s.id, fila.id, Number(texto));
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
          <div>
            <label className={labelClass}>Precio de venta Olavarría</label>
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

          <div className="border-t border-border pt-3">
            <p className="mb-1 text-[12px] font-medium text-text-2">
              Precio en efectivo (solo billete en mano)
            </p>
            <p className="mb-2 text-[11.5px] text-text-3">
              Monto fijo para este producto. Pisa el descuento por efectivo de la categoría.
              Vacío = sigue el de la categoría.
            </p>
            {sucursales.map((s) => (
              <div key={s.id} className="mb-2">
                <label className={labelClass}>{s.nombre}</label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  className={inputClass}
                  value={efectivos[s.id] ?? ""}
                  onChange={(e) => setEfectivos((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  placeholder="Sin precio propio"
                />
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-[12px] font-medium text-text-2">
              Excepción manual (pisa el precio calculado o el recargo)
            </p>
            {sucursales
              .filter((s) => !s.es_central)
              .map((s) => (
                <div key={s.id} className="mb-2">
                  <label className={labelClass}>{s.nombre}</label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    className={inputClass}
                    value={overrides[s.id] ?? ""}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder="Sin excepción"
                  />
                </div>
              ))}
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
