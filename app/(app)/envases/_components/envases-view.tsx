"use client";

import { useMemo, useState, useTransition } from "react";
import { formatoFecha, formatoMoneda } from "../../compras/_lib/formato";
import {
  registrarAjusteEnvase,
  registrarDevolucionProveedor,
  registrarDevolucionSueltos,
} from "../actions";
import {
  MovimientoEnvaseBadge,
  type TipoMovimientoEnvase,
} from "./movimiento-envase-badge";

export type Sucursal = { id: string; nombre: string; es_central: boolean };
export type TipoEnvase = {
  id: string;
  nombre: string;
  es_generico: boolean;
  valor_deposito: number;
};
type StockRow = { tipo_envase_id: string; sucursal_id: string; cantidad_vacios: number };
export type MovimientoEnvaseRow = {
  id: string;
  tipo: TipoMovimientoEnvase;
  cantidad: number;
  motivo: string | null;
  fecha: string;
  sucursal_id: string;
  tipo_envase: { nombre: string } | null;
};

type Formulario = "sueltos" | "proveedor" | "ajuste" | null;

export function EnvasesView({
  sucursales,
  tiposEnvase,
  stock,
  movimientos,
  operaSucursalMap,
}: {
  sucursales: Sucursal[];
  tiposEnvase: TipoEnvase[];
  stock: StockRow[];
  movimientos: MovimientoEnvaseRow[];
  operaSucursalMap: Record<string, boolean>;
}) {
  const primeraOperable = sucursales.find((s) => operaSucursalMap[s.id])?.id;
  const [sucursalId, setSucursalId] = useState(primeraOperable ?? sucursales[0]?.id ?? "");
  const [formulario, setFormulario] = useState<Formulario>(null);

  const sucursal = sucursales.find((s) => s.id === sucursalId) ?? null;
  const puedeOperar = Boolean(sucursal && operaSucursalMap[sucursal.id]);

  const stockPorTipo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const fila of stock) {
      if (fila.sucursal_id !== sucursalId) continue;
      mapa.set(fila.tipo_envase_id, fila.cantidad_vacios);
    }
    return mapa;
  }, [stock, sucursalId]);

  const movimientosSucursal = useMemo(
    () => movimientos.filter((m) => m.sucursal_id === sucursalId),
    [movimientos, sucursalId],
  );

  function elegirSucursal(id: string) {
    setSucursalId(id);
    setFormulario(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {sucursales.length > 1 && (
        <div className="rounded-card border border-border bg-bg p-4">
          <h2 className="mb-2 text-[13px] font-semibold text-text">Sucursal</h2>
          <div className="flex gap-2">
            {sucursales.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => elegirSucursal(s.id)}
                className={`rounded-[6px] border px-[12px] py-[7px] text-[13px] font-medium ${
                  s.id === sucursalId
                    ? "border-moe bg-moe-soft text-moe"
                    : "border-border bg-bg text-text-2 hover:bg-bg-2"
                }`}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        </div>
      )}

      {!puedeOperar && (
        <div className="rounded-card border border-border bg-bg p-4 text-[12.5px] text-text-2">
          Solo podés ver los envases de esta sucursal, no tenés permiso para registrar
          movimientos acá.
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
          <h2 className="text-[13px] font-semibold text-text">Stock de envases</h2>
          {puedeOperar && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFormulario(formulario === "sueltos" ? null : "sueltos")}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
              >
                Devolución de vacíos sueltos
              </button>
              {sucursal?.es_central && (
                <button
                  type="button"
                  onClick={() => setFormulario(formulario === "proveedor" ? null : "proveedor")}
                  className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
                >
                  Devolución al proveedor
                </button>
              )}
              <button
                type="button"
                onClick={() => setFormulario(formulario === "ajuste" ? null : "ajuste")}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
              >
                Ajustar
              </button>
            </div>
          )}
        </div>

        {formulario && sucursal && (
          <MovimientoForm
            modo={formulario}
            sucursalId={sucursal.id}
            tiposEnvase={tiposEnvase}
            stockPorTipo={stockPorTipo}
            onHecho={() => setFormulario(null)}
          />
        )}

        {tiposEnvase.length === 0 ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">
              Todavía no hay tipos de envase cargados
            </p>
            <p className="text-[12.5px] text-text-3">
              Se cargan desde la ficha de producto, en Productos.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                    Tipo de envase
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                    Depósito
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                    Vacíos en stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {tiposEnvase.map((t) => (
                  <tr key={t.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
                    <td className="px-[14px] py-[9px] align-middle font-medium text-text">
                      {t.nombre}
                      <span className="ml-[8px] text-[11.5px] font-normal text-text-3">
                        {t.es_generico ? "Genérico" : "Específico"}
                      </span>
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {formatoMoneda.format(t.valor_deposito)}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle text-[15px] font-medium tabular-nums text-text">
                      {stockPorTipo.get(t.id) ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="border-b border-border px-[14px] py-[11px]">
          <h2 className="text-[13px] font-semibold text-text">Movimientos recientes</h2>
        </div>

        {movimientosSucursal.length === 0 ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="text-[12.5px] text-text-3">
              Todavía no hay movimientos de envases en {sucursal?.nombre ?? "esta sucursal"}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                    Fecha
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                    Tipo de envase
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                    Movimiento
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                    Cantidad
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                    Motivo
                  </th>
                </tr>
              </thead>
              <tbody>
                {movimientosSucursal.map((m) => (
                  <tr key={m.id} className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]">
                    <td className="px-[14px] py-[9px] align-middle text-text-2">
                      {formatoFecha.format(new Date(m.fecha))}
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text">
                      {m.tipo_envase?.nombre ?? "—"}
                    </td>
                    <td className="px-[14px] py-[9px] align-middle">
                      <MovimientoEnvaseBadge tipo={m.tipo} />
                    </td>
                    <td
                      className={`px-[14px] py-[9px] text-right align-middle tabular-nums font-medium ${
                        m.cantidad > 0 ? "text-ok" : "text-text-2"
                      }`}
                    >
                      {m.cantidad > 0 ? "+" : ""}
                      {m.cantidad}
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text-3">
                      {m.motivo ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const FORM_TITLE: Record<Exclude<Formulario, null>, string> = {
  sueltos: "Devolución de vacíos sueltos",
  proveedor: "Devolución al proveedor",
  ajuste: "Ajustar stock de envases",
};

function MovimientoForm({
  modo,
  sucursalId,
  tiposEnvase,
  stockPorTipo,
  onHecho,
}: {
  modo: Exclude<Formulario, null>;
  sucursalId: string;
  tiposEnvase: TipoEnvase[];
  stockPorTipo: Map<string, number>;
  onHecho: () => void;
}) {
  const [tipoEnvaseId, setTipoEnvaseId] = useState(tiposEnvase[0]?.id ?? "");
  const [cantidad, setCantidad] = useState("");
  const [signo, setSigno] = useState<1 | -1>(1);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar() {
    const valor = Number(cantidad);
    if (!tipoEnvaseId) {
      setError("Elegí un tipo de envase.");
      return;
    }
    if (!Number.isInteger(valor) || valor <= 0) {
      setError("La cantidad tiene que ser un entero mayor a cero.");
      return;
    }
    if (modo === "ajuste" && motivo.trim() === "") {
      setError("Un ajuste necesita motivo.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const resultado =
        modo === "sueltos"
          ? await registrarDevolucionSueltos(tipoEnvaseId, sucursalId, valor)
          : modo === "proveedor"
            ? await registrarDevolucionProveedor(tipoEnvaseId, sucursalId, valor)
            : await registrarAjusteEnvase(tipoEnvaseId, sucursalId, valor * signo, motivo.trim());

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      setCantidad("");
      setMotivo("");
      onHecho();
    });
  }

  return (
    <div className="border-b border-border bg-bg-2 px-[14px] py-[12px]">
      <p className="mb-[8px] text-[12.5px] font-semibold text-text">{FORM_TITLE[modo]}</p>

      {modo === "sueltos" && (
        <p className="mb-[8px] text-[12px] text-text-3">
          Registra el vacío que devuelve el cliente. Devolver el depósito cobrado es un
          movimiento de caja, se hace aparte.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-[10px]">
        <label className="flex flex-col gap-[3px]">
          <span className="text-[11.5px] text-text-2">Tipo de envase</span>
          <select
            value={tipoEnvaseId}
            onChange={(e) => setTipoEnvaseId(e.target.value)}
            className="w-[220px] rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
          >
            {tiposEnvase.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} ({stockPorTipo.get(t.id) ?? 0} en stock)
              </option>
            ))}
          </select>
        </label>

        {modo === "ajuste" && (
          <label className="flex flex-col gap-[3px]">
            <span className="text-[11.5px] text-text-2">Dirección</span>
            <select
              value={signo}
              onChange={(e) => setSigno(Number(e.target.value) as 1 | -1)}
              className="w-[100px] rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
            >
              <option value={1}>Sumar</option>
              <option value={-1}>Restar</option>
            </select>
          </label>
        )}

        <label className="flex flex-col gap-[3px]">
          <span className="text-[11.5px] text-text-2">Cantidad</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="w-[90px] rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
          />
        </label>

        {modo === "ajuste" && (
          <label className="flex flex-1 flex-col gap-[3px]">
            <span className="text-[11.5px] text-text-2">Motivo (obligatorio)</span>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: rotura durante el conteo"
              className="min-w-[180px] rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
            />
          </label>
        )}

        <button
          type="button"
          onClick={enviar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Registrar"}
        </button>
      </div>

      {error && <p className="mt-[8px] text-[12.5px] text-err">{error}</p>}
    </div>
  );
}
