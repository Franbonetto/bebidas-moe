"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { crearCompra } from "../actions";
import { formatoMoneda } from "../_lib/formato";
import { SkuPicker, type SkuCatalogo } from "./sku-picker";
import { actualizarCodigoBarras } from "@/app/(app)/productos/actions";

type Proveedor = { id: string; razon_social: string; nombre_comercial: string | null };

type Linea = {
  sku: SkuCatalogo;
  cantidad: number;
  costoUnitario: number;
};

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

export function CompraForm({ proveedores, skus }: { proveedores: Proveedor[]; skus: SkuCatalogo[] }) {
  const router = useRouter();
  const [proveedorId, setProveedorId] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fechaFactura, setFechaFactura] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const excluirIds = useMemo(() => new Set(lineas.map((l) => l.sku.id)), [lineas]);
  const total = lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario, 0);

  // Reescanear un código de barras ya cargado suma 1 a esa línea en vez de
  // duplicarla (el picker deja pasar el match aunque esté en excluirIds,
  // justamente para este caso).
  function agregarLinea(sku: SkuCatalogo) {
    setLineas((prev) => {
      const idx = prev.findIndex((l) => l.sku.id === sku.id);
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      return [...prev, { sku, cantidad: 1, costoUnitario: 0 }];
    });
  }

  function actualizarLinea(index: number, campo: "cantidad" | "costoUnitario", valor: number) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, [campo]: valor } : l)));
  }

  function quitarLinea(index: number) {
    setLineas((prev) => prev.filter((_, i) => i !== index));
  }

  function validar(): string | null {
    if (!proveedorId) return "Elegí un proveedor.";
    if (lineas.length === 0) return "Agregá al menos una línea.";
    for (const l of lineas) {
      if (!Number.isInteger(l.cantidad) || l.cantidad <= 0)
        return "La cantidad tiene que ser un entero mayor a cero.";
      if (l.costoUnitario < 0) return "El costo unitario no puede ser negativo.";
    }
    return null;
  }

  function guardar(confirmar: boolean) {
    const errorValidacion = validar();
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }
    setError(null);
    startTransition(async () => {
      const resultado = await crearCompra({
        proveedor_id: proveedorId,
        numero_factura: numeroFactura.trim() || null,
        fecha_factura: fechaFactura || null,
        lineas: lineas.map((l) => ({
          sku_id: l.sku.id,
          cantidad: l.cantidad,
          costo_unitario: l.costoUnitario,
        })),
        confirmar,
      });

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push(`/compras/${resultado.id}`);
    });
  }

  return (
    <div className="mx-auto max-w-[880px] rounded-card border border-border bg-bg p-5">
      <h2 className="mb-4 text-[14px] font-semibold text-text">Nueva compra</h2>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Proveedor *</label>
          <select
            className={inputClass}
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">Elegir…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre_comercial ?? p.razon_social}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Número de factura</label>
          <input
            className={inputClass}
            value={numeroFactura}
            onChange={(e) => setNumeroFactura(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Fecha de factura</label>
          <input
            type="date"
            className={inputClass}
            value={fechaFactura}
            onChange={(e) => setFechaFactura(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-5">
        <label className={labelClass}>Agregar línea</label>
        <SkuPicker
          skus={skus}
          excluirIds={excluirIds}
          onSelect={agregarLinea}
          onAsignarCodigoBarras={actualizarCodigoBarras}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-[6px] border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border-b border-border bg-bg-2 px-[12px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                SKU
              </th>
              <th className="w-[100px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Cantidad
              </th>
              <th className="w-[140px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Costo unit.
              </th>
              <th className="w-[120px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Subtotal
              </th>
              <th className="w-[40px] border-b border-border bg-bg-2 px-[12px] py-[7px]" />
            </tr>
          </thead>
          <tbody>
            {lineas.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-[12px] py-[16px] text-center text-[12.5px] text-text-3">
                  Todavía no agregaste líneas.
                </td>
              </tr>
            ) : (
              lineas.map((l, i) => (
                <tr key={l.sku.id} className="border-b border-[#F1F1F3] last:border-b-0">
                  <td className="px-[12px] py-[7px] align-middle">
                    <p className="font-medium text-text">{l.sku.producto?.nombre}</p>
                    <p className="text-[11.5px] text-text-3">
                      {l.sku.producto?.marca?.nombre} — {presentacionLabel(l.sku)}
                    </p>
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    <input
                      type="number"
                      min={1}
                      className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                      value={l.cantidad}
                      onChange={(e) => actualizarLinea(i, "cantidad", Number(e.target.value))}
                    />
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                      value={l.costoUnitario}
                      onChange={(e) => actualizarLinea(i, "costoUnitario", Number(e.target.value))}
                    />
                  </td>
                  <td className="px-[12px] py-[7px] text-right align-middle tabular-nums text-text">
                    {formatoMoneda.format(l.cantidad * l.costoUnitario)}
                  </td>
                  <td className="px-[12px] py-[7px] text-right align-middle">
                    <button
                      type="button"
                      onClick={() => quitarLinea(i)}
                      className="text-[12px] text-text-3 hover:text-err"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-end">
        <p className="text-[13px] font-semibold text-text">
          Total: <span className="tabular-nums">{formatoMoneda.format(total)}</span>
        </p>
      </div>

      {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => guardar(false)}
          disabled={pending}
          className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2 disabled:opacity-60"
        >
          Guardar borrador
        </button>
        <button
          type="button"
          onClick={() => guardar(true)}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          Confirmar compra
        </button>
      </div>
    </div>
  );
}
