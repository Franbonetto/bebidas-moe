"use client";

import { useState } from "react";
import { editarSku } from "../actions";
import { presentacionLabel } from "../_lib/presentacion";
import type { SkuRow } from "./productos-table";

const TIPOS: { id: SkuRow["tipo_presentacion"]; label: string }[] = [
  { id: "unidad", label: "Unidad" },
  { id: "pack", label: "Pack" },
  { id: "cajon", label: "Cajón" },
  { id: "estuche", label: "Estuche" },
];

// 'un' y 'g' existen para lo que no es líquido (tabaco, regalería,
// embutidos): ver migración 20260910090000_unidad_volumen_un_gramo.
const UNIDADES: { id: SkuRow["unidad_volumen"]; label: string }[] = [
  { id: "ml", label: "ml" },
  { id: "l", label: "l" },
  { id: "un", label: "un" },
  { id: "g", label: "g" },
];

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13.5px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

export function EditarSkuModal({
  sku,
  onClose,
  onGuardado,
}: {
  sku: SkuRow;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombreProducto, setNombreProducto] = useState(sku.producto?.nombre ?? "");
  const [nombreSku, setNombreSku] = useState(sku.nombre);
  const [tipo, setTipo] = useState<SkuRow["tipo_presentacion"]>(sku.tipo_presentacion);
  const [unidades, setUnidades] = useState(String(sku.unidades_contenidas));
  const [volumen, setVolumen] = useState(String(sku.volumen));
  const [unidadVolumen, setUnidadVolumen] = useState(sku.unidad_volumen);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const unidadesNum = Number(unidades);
  const volumenNum = Number(volumen);

  // Cómo va a quedar escrita la presentación en el catálogo y en el punto de
  // venta: se arma con la misma función que usa la tabla, así lo que se ve
  // acá es exactamente lo que se va a ver después.
  const vistaPrevia =
    Number.isFinite(volumenNum) && volumenNum > 0 && Number.isInteger(unidadesNum) && unidadesNum > 0
      ? presentacionLabel({
          tipo_presentacion: tipo,
          volumen: volumenNum,
          unidad_volumen: unidadVolumen,
          unidades_contenidas: unidadesNum,
        })
      : null;

  const cambioUnidades = unidadesNum !== sku.unidades_contenidas;

  async function guardar() {
    setError(null);
    setGuardando(true);
    const resultado = await editarSku(sku.id, {
      nombreProducto,
      nombreSku,
      tipoPresentacion: tipo,
      unidadesContenidas: unidadesNum,
      volumen: volumenNum,
      unidadVolumen: unidadVolumen as "ml" | "l" | "un" | "g",
    });
    setGuardando(false);

    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }
    onGuardado();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[520px] overflow-y-auto rounded-card border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Editar producto</h2>
            <p className="text-[12px] text-text-3">
              Código interno {sku.codigo_interno}
              {sku.producto?.marca?.nombre ? ` · ${sku.producto.marca.nombre}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12.5px] text-text-3 hover:text-text"
          >
            Cerrar
          </button>
        </div>

        <div className="mb-[14px]">
          <label className={labelClass}>Nombre del producto</label>
          <input
            autoFocus
            type="text"
            value={nombreProducto}
            onChange={(e) => setNombreProducto(e.target.value)}
            className={inputClass}
          />
          <p className="mt-[4px] text-[11.5px] text-text-3">
            Es el que agrupa todas las presentaciones y el que se ve en el catálogo. Si lo
            cambiás, cambia para el resto de las presentaciones del mismo producto.
          </p>
        </div>

        <div className="mb-[14px]">
          <label className={labelClass}>Nombre de esta presentación</label>
          <input
            type="text"
            value={nombreSku}
            onChange={(e) => setNombreSku(e.target.value)}
            className={inputClass}
          />
          <p className="mt-[4px] text-[11.5px] text-text-3">
            Es el que busca la vendedora en el punto de venta cuando escribe en vez de escanear.
          </p>
        </div>

        <div className="mb-[14px] grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Presentación</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as SkuRow["tipo_presentacion"])}
              className={inputClass}
            >
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Unidades que contiene</label>
            <input
              type="number"
              min={1}
              step={1}
              value={unidades}
              onChange={(e) => setUnidades(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
          </div>
        </div>

        <div className="mb-[14px] grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Contenido</label>
            <input
              type="number"
              min={0}
              step="any"
              value={volumen}
              onChange={(e) => setVolumen(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
          </div>
          <div>
            <label className={labelClass}>Unidad</label>
            <select
              value={unidadVolumen}
              onChange={(e) => setUnidadVolumen(e.target.value)}
              className={inputClass}
            >
              {UNIDADES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {vistaPrevia && (
          <p className="mb-[14px] rounded-[6px] bg-bg-2 px-[10px] py-[7px] text-[12.5px] text-text-2">
            Va a figurar como <span className="font-medium text-text">{vistaPrevia}</span>
          </p>
        )}

        {/* El recargo de Laprida es un monto fijo por categoría multiplicado
            por las unidades contenidas (CLAUDE.md, Precios), así que tocar
            este número le mueve el precio a Laprida sin que nadie toque un
            precio. Se avisa, no se bloquea. */}
        {cambioUnidades && Number.isInteger(unidadesNum) && unidadesNum > 0 && (
          <p className="mb-[14px] rounded-[6px] bg-warn-bg px-[10px] py-[7px] text-[12.5px] text-warn">
            Cambiar las unidades contenidas también cambia el precio de Laprida, que se calcula
            como el recargo de la categoría por cada unidad.
          </p>
        )}

        {error && <p className="mb-[12px] text-[12.5px] text-err">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-text-3 hover:text-text"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={guardar}
            className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
