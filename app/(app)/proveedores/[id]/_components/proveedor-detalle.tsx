"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ComprasTable,
  type Compra,
} from "@/app/(app)/compras/_components/compras-table";
import { estadoPagoCompra, totalAbonadoCompra } from "@/app/(app)/compras/_lib/pagos";
import { totalPagadoCompra } from "@/app/(app)/compras/_lib/comprobante";
import { formatoFechaHora, formatoMonedaExacto } from "@/app/(app)/compras/_lib/formato";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_lib/presentacion";
import { ProveedorForm } from "../../_components/proveedor-form";
import type { Proveedor } from "../../_components/proveedores-table";
import {
  registrarAjusteCuentaProveedor,
  type TipoAjusteCuentaProveedor,
} from "../../actions";

// Los dos tipos manuales (lo único que carga el dueño a mano) más los dos
// que genera el sistema solo, cuando se paga de más una boleta puntual o se
// anula ese excedente.
export type TipoAjusteCuentaCompleto =
  | "aumento_deuda"
  | "credito_a_favor"
  | "excedente_pago"
  | "reversa_excedente";

export type AjusteCuentaProveedor = {
  id: string;
  tipo: TipoAjusteCuentaCompleto;
  monto: number;
  nota: string;
  fecha: string;
  usuario: { nombre: string } | null;
};

export type ProductoProveedor = {
  sku_id: string;
  costo_referencia: number | null;
  activo: boolean;
  stock: number;
  sku:
    | (SkuPresentacion & {
        id: string;
        nombre: string;
        codigo_interno: string;
        producto: { nombre: string; marca: { nombre: string } | null } | null;
      })
    | null;
};

const AJUSTE_TIPO_LABEL: Record<TipoAjusteCuentaCompleto, string> = {
  aumento_deuda: "Deuda agregada",
  credito_a_favor: "Crédito a favor",
  excedente_pago: "Excedente de un pago",
  reversa_excedente: "Reversa de un excedente",
};

// Suma deuda (positivo) o la resta (negativo) -- mismo signo que usa el
// cálculo del saldo de la cuenta.
function signoAjuste(tipo: TipoAjusteCuentaCompleto): 1 | -1 {
  return tipo === "aumento_deuda" || tipo === "reversa_excedente" ? 1 : -1;
}

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

function nombreSku(sku: ProductoProveedor["sku"]) {
  if (!sku) return "SKU eliminado";
  return sku.producto?.nombre ?? sku.nombre;
}

function presentacionSku(sku: ProductoProveedor["sku"]) {
  if (!sku) return "";
  return [sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ");
}

// Cargar deuda a mano o crédito a favor. Sin PIN: pantalla privada del
// dueño, no el mostrador (pedido del usuario 2026-10-30).
function AjusteCuentaForm({
  proveedorId,
  tipo,
  onCancelar,
  onListo,
}: {
  proveedorId: string;
  tipo: TipoAjusteCuentaProveedor;
  onCancelar: () => void;
  onListo: () => void;
}) {
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function guardar() {
    setError(null);
    const montoNum = Number(monto);
    if (!monto || !Number.isFinite(montoNum) || montoNum <= 0) {
      setError("El monto tiene que ser mayor a cero.");
      return;
    }
    if (!nota.trim()) {
      setError("Escribí una nota: qué es y por qué.");
      return;
    }
    startTransition(async () => {
      const resultado = await registrarAjusteCuentaProveedor({
        proveedor_id: proveedorId,
        tipo,
        monto: montoNum,
        nota,
      });
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onListo();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-[420px] rounded-card border border-border bg-bg p-5">
        <h2 className="mb-4 text-[14px] font-semibold text-text">
          {tipo === "aumento_deuda" ? "Agregar deuda" : "Agregar crédito a favor"}
        </h2>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass}>Monto *</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={`${inputClass} text-right tabular-nums`}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className={labelClass}>Nota: qué es y por qué *</label>
            <textarea
              className={inputClass}
              rows={2}
              placeholder={
                tipo === "aumento_deuda"
                  ? "Ej.: saldo arrastrado de antes de usar el sistema"
                  : "Ej.: nos devolvió mercadería en mal estado el 20/10"
              }
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
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

function CuentaProveedorPanel({
  proveedorId,
  compras,
  ajustes,
}: {
  proveedorId: string;
  compras: Compra[];
  ajustes: AjusteCuentaProveedor[];
}) {
  const router = useRouter();
  const [formAjuste, setFormAjuste] = useState<TipoAjusteCuentaProveedor | null>(null);

  const boletasPendientes = useMemo(() => {
    return compras.reduce((acc, c) => {
      const totalAPagar = totalPagadoCompra(c);
      const abonado = totalAbonadoCompra(c.pagos ?? []);
      const estado = estadoPagoCompra(totalAPagar, abonado);
      if (estado === "pagada") return acc;
      return acc + Math.max(totalAPagar - abonado, 0);
    }, 0);
  }, [compras]);

  const saldoCuentaAparte = useMemo(
    () => ajustes.reduce((acc, a) => acc + signoAjuste(a.tipo) * a.monto, 0),
    [ajustes],
  );

  const totalGeneral = boletasPendientes + saldoCuentaAparte;

  return (
    <div className="rounded-card border border-border bg-bg p-5">
      <h3 className="text-[13px] font-semibold text-text">Cuenta con el proveedor</h3>

      <div className="mt-3 flex flex-wrap items-baseline gap-5 border-t border-border pt-3">
        <div>
          <p className="text-[11.5px] text-text-3">Boletas pendientes</p>
          <p className="text-[15px] font-semibold tabular-nums text-text">
            {formatoMonedaExacto.format(boletasPendientes)}
          </p>
        </div>
        <div>
          <p className="text-[11.5px] text-text-3">Cuenta aparte</p>
          <p
            className={`text-[15px] font-semibold tabular-nums ${
              saldoCuentaAparte > 0 ? "text-err" : saldoCuentaAparte < 0 ? "text-ok" : "text-text-3"
            }`}
          >
            {saldoCuentaAparte < 0 ? "A favor: " : ""}
            {formatoMonedaExacto.format(Math.abs(saldoCuentaAparte))}
          </p>
        </div>
        <div>
          <p className="text-[11.5px] text-text-3">Total a pagarle</p>
          <p className="text-[17px] font-semibold tabular-nums text-text">
            {formatoMonedaExacto.format(Math.max(totalGeneral, 0))}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setFormAjuste("aumento_deuda")}
          className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-text hover:bg-bg-2"
        >
          Agregar deuda
        </button>
        <button
          type="button"
          onClick={() => setFormAjuste("credito_a_favor")}
          className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-text hover:bg-bg-2"
        >
          Agregar crédito a favor
        </button>
      </div>

      {ajustes.length > 0 && (
        <div className="mt-3 flex flex-col gap-[4px] border-t border-border pt-3">
          {ajustes.map((a) => {
            const signo = signoAjuste(a.tipo);
            return (
              <div key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
                <span className="text-text-2">
                  {formatoFechaHora.format(new Date(a.fecha))} · {AJUSTE_TIPO_LABEL[a.tipo]} ·{" "}
                  {a.usuario?.nombre ?? "—"} — {a.nota}
                </span>
                <span className={`tabular-nums font-medium ${signo > 0 ? "text-err" : "text-ok"}`}>
                  {signo > 0 ? "+" : "−"}
                  {formatoMonedaExacto.format(a.monto)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {formAjuste && (
        <AjusteCuentaForm
          proveedorId={proveedorId}
          tipo={formAjuste}
          onCancelar={() => setFormAjuste(null)}
          onListo={() => {
            setFormAjuste(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

export function ProveedorDetalle({
  proveedor,
  compras,
  ajustes,
  productos,
  sucursalCentralNombre,
  esDueno,
}: {
  proveedor: Proveedor;
  compras: Compra[];
  ajustes: AjusteCuentaProveedor[];
  productos: ProductoProveedor[];
  sucursalCentralNombre: string | null;
  esDueno: boolean;
}) {
  const [editando, setEditando] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/proveedores" className="text-[12.5px] font-medium text-moe hover:underline">
          ← Proveedores
        </Link>
      </div>

      <div className="rounded-card border border-border bg-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">{proveedor.razon_social}</h2>
            {proveedor.nombre_comercial && (
              <p className="mt-[1px] text-[12.5px] text-text-3">{proveedor.nombre_comercial}</p>
            )}
            <p className="mt-[4px] text-[12.5px] text-text-2">
              {proveedor.cuit ? `CUIT ${proveedor.cuit}` : "Sin CUIT"}
              {proveedor.condicion_pago ? ` · ${proveedor.condicion_pago}` : ""}
              {proveedor.plazo_dias != null ? ` · ${proveedor.plazo_dias} días de plazo` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
                proveedor.activo ? "bg-ok-bg text-ok" : "bg-bg-2 text-text-3"
              }`}
            >
              {proveedor.activo ? "Activo" : "Inactivo"}
            </span>
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="text-[12.5px] font-medium text-moe hover:underline"
            >
              Editar
            </button>
          </div>
        </div>
      </div>

      {esDueno && (
        <CuentaProveedorPanel proveedorId={proveedor.id} compras={compras} ajustes={ajustes} />
      )}

      <ComprasTable compras={compras} puedeCargar={false} esDueno={esDueno} />

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="border-b border-border px-[14px] py-[11px]">
          <h3 className="text-[13px] font-semibold text-text">
            Productos de este proveedor{sucursalCentralNombre ? ` en ${sucursalCentralNombre}` : ""}
          </h3>
        </div>

        {productos.length === 0 ? (
          <div className="px-[14px] py-[20px] text-center text-[12.5px] text-text-3">
            Este proveedor todavía no tiene productos asociados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    SKU
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Costo de referencia
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr key={p.sku_id} className="border-b border-[#F1F1F3] last:border-b-0">
                    <td className="px-[14px] py-[9px] align-middle">
                      <p className="font-medium text-text">{nombreSku(p.sku)}</p>
                      <p className="text-[11.5px] text-text-3">{presentacionSku(p.sku)}</p>
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                      {p.costo_referencia != null ? formatoMonedaExacto.format(p.costo_referencia) : "—"}
                    </td>
                    <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text">
                      {p.stock}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editando && <ProveedorForm proveedor={proveedor} onClose={() => setEditando(false)} />}
    </div>
  );
}
