"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { SkuPicker, type SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { registrarMerma, stockActualDeSku } from "../actions";
import { MOTIVOS_MERMA, MOTIVO_MERMA_LABEL, type MotivoMerma } from "../_lib/motivos";

type Sucursal = { id: string; nombre: string };
type Empleado = { id: string; nombre: string; sucursal_id: string };

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[14px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

export function MermaForm({
  sucursales,
  empleados,
  skus,
}: {
  sucursales: Sucursal[];
  empleados: Empleado[];
  skus: SkuCatalogo[];
}) {
  const router = useRouter();
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [sku, setSku] = useState<SkuCatalogo | null>(null);
  const [stockActual, setStockActual] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState<MotivoMerma | "">("");
  const [empleadoId, setEmpleadoId] = useState("");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function elegirSku(elegido: SkuCatalogo) {
    setSku(elegido);
    setError(null);
    setOk(null);
    setStockActual(null);
    const resultado = await stockActualDeSku(elegido.id, sucursalId);
    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }
    setStockActual(resultado.stock);
  }

  function limpiar() {
    setSku(null);
    setStockActual(null);
    setCantidad("");
    setMotivo("");
    setEmpleadoId("");
    setDetalle("");
    setError(null);
  }

  function guardar() {
    if (!sku) return;
    const cantidadNum = Number(cantidad);
    if (cantidad === "" || !Number.isInteger(cantidadNum) || cantidadNum <= 0) {
      setError("Escribí cuántas unidades se perdieron.");
      return;
    }
    if (!motivo) {
      setError("Elegí un motivo.");
      return;
    }
    if (!empleadoId) {
      setError("Elegí quién la registra.");
      return;
    }
    if (motivo === "otro" && !detalle.trim()) {
      setError("Contá qué pasó.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const resultado = await registrarMerma({
        sku_id: sku.id,
        sucursal_id: sucursalId,
        cantidad: cantidadNum,
        motivo,
        empleado_id: empleadoId,
        detalle: detalle.trim() || null,
      });

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }

      const nombre = sku.producto?.nombre ?? sku.codigo_interno;
      setOk(`Registrado: ${cantidadNum} × ${nombre}. El stock ya quedó descontado.`);
      limpiar();
      router.refresh();
    });
  }

  // Cada mostrador ve solo a su gente: la función además lo valida contra
  // la base, para que desde Laprida no se pueda cargar a nombre de alguien
  // de Olavarría.
  const empleadosDeLaSucursal = empleados.filter((e) => e.sucursal_id === sucursalId);

  // Avisa, no bloquea: que el stock quede negativo es información real (el
  // conteo estaba mal), no algo para esconder.
  const quedaNegativo =
    stockActual !== null && cantidad !== "" && Number(cantidad) > stockActual;

  return (
    <div className="rounded-card border border-border bg-bg p-5">
      <h1 className="text-[15px] font-semibold text-text">Registrar merma</h1>
      <p className="mt-[3px] text-[12.5px] leading-[1.5] text-text-3">
        Lo que se rompió, se venció o se consumió adentro del local. Anotalo en el momento: lo que
        queda sin explicar en el próximo inventario es lo que realmente falta.
      </p>

      {ok && (
        <p className="mt-3 rounded-[6px] border border-ok/30 bg-ok-bg px-[12px] py-[8px] text-[12.5px] text-ok">
          {ok}
        </p>
      )}

      {sucursales.length > 1 && (
        <div className="mt-4">
          <label className={labelClass}>Sucursal</label>
          <select
            className={inputClass}
            value={sucursalId}
            onChange={(e) => {
              setSucursalId(e.target.value);
              limpiar();
            }}
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4">
        <label className={labelClass}>Producto</label>
        <SkuPicker skus={skus} excluirIds={new Set()} onSelect={elegirSku} />
      </div>

      {sku && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-[14px] font-semibold text-text">
            {sku.producto?.nombre ?? sku.codigo_interno}
          </p>
          <p className="text-[12.5px] text-text-3">
            {[sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ")}
            {stockActual !== null && ` · quedan ${stockActual}`}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
            <div>
              <label className={labelClass}>Cantidad *</label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                autoFocus
                className={`${inputClass} text-right tabular-nums`}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>¿Qué pasó? *</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MOTIVOS_MERMA.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMotivo(m)}
                    className={`rounded-[6px] border px-[8px] py-[7px] text-[12.5px] font-medium ${
                      motivo === m
                        ? "border-moe bg-moe-soft text-moe"
                        : "border-border bg-bg text-text-2 hover:bg-[#FAFAFB]"
                    }`}
                  >
                    {MOTIVO_MERMA_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3">
            <label className={labelClass}>¿Quién la registra? *</label>
            <select
              className={inputClass}
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
            >
              <option value="">Elegir…</option>
              {empleadosDeLaSucursal.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            {empleadosDeLaSucursal.length === 0 && (
              <p className="mt-[3px] text-[11.5px] text-warn">
                No hay empleados cargados en esta sucursal.
              </p>
            )}
          </div>

          <div className="mt-3">
            <label className={labelClass}>
              Detalle {motivo === "otro" ? "*" : "(opcional)"}
            </label>
            <input
              className={inputClass}
              placeholder="Ej.: se cayó una caja al bajarla del estante"
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
            />
          </div>

          {quedaNegativo && (
            <p className="mt-3 rounded-[6px] border border-warn/40 bg-warn-bg px-[12px] py-[8px] text-[12.5px] text-warn">
              Estás registrando más unidades de las que figuran en el sistema. Se puede guardar
              igual, pero anotalo: quiere decir que el stock de este producto ya estaba mal.
            </p>
          )}

          {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={limpiar}
              className="text-[12.5px] text-text-3 hover:text-text"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={pending}
              className="rounded-[6px] bg-moe px-[14px] py-[8px] text-[13.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
            >
              {pending ? "Registrando…" : "Registrar merma"}
            </button>
          </div>
        </div>
      )}

      {!sku && error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}
    </div>
  );
}
