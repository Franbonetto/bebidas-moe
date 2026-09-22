"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { cargarCompraDirecta } from "../actions";
import { guardarPrecioBase } from "@/app/(app)/precios/actions";
import { actualizarCodigoBarras, activarCascadaCerveza } from "@/app/(app)/productos/actions";
import { calcularCascadaCerveza } from "@/lib/precios";
import { formatoMoneda } from "../_lib/formato";
import { SkuPicker, type SkuCatalogo } from "./sku-picker";

type Proveedor = { id: string; razon_social: string; nombre_comercial: string | null };
type CostoReferencia = { proveedor_id: string; sku_id: string; costo_referencia: number | null };

type Linea = {
  sku: SkuCatalogo;
  cantidad: number;
  costoUnitario: number;
  precioVenta: number | null;
  activarCascada: boolean;
};

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

export function CompraDirectaForm({
  proveedores,
  skus,
  costosReferencia,
  skusConCascadaOfrecida,
}: {
  proveedores: Proveedor[];
  skus: SkuCatalogo[];
  costosReferencia: CostoReferencia[];
  // Pack x24 de una familia de cerveza en lata que todavía no tiene la
  // cascada activada (ver compras/directa/page.tsx) -- ahí se ofrece
  // activarla con vista previa en vivo del precio del x6 y la unidad.
  skusConCascadaOfrecida: string[];
}) {
  const cascadaOfrecidaIds = useMemo(() => new Set(skusConCascadaOfrecida), [skusConCascadaOfrecida]);
  const router = useRouter();
  const [proveedorId, setProveedorId] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fechaFactura, setFechaFactura] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [avisoPrecio, setAvisoPrecio] = useState<string | null>(null);
  const [compraCreadaId, setCompraCreadaId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const excluirIds = useMemo(() => new Set(lineas.map((l) => l.sku.id)), [lineas]);
  const total = lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario, 0);

  function costoSugerido(skuId: string): number {
    if (!proveedorId) return 0;
    const referencia = costosReferencia.find(
      (c) => c.proveedor_id === proveedorId && c.sku_id === skuId,
    );
    return referencia?.costo_referencia ?? 0;
  }

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
      return [
        ...prev,
        { sku, cantidad: 1, costoUnitario: costoSugerido(sku.id), precioVenta: null, activarCascada: false },
      ];
    });
  }

  function actualizarLinea(
    index: number,
    campo: "cantidad" | "costoUnitario" | "precioVenta",
    valor: number | null,
  ) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, [campo]: valor } : l)));
  }

  function alternarCascada(index: number, activar: boolean) {
    setLineas((prev) =>
      prev.map((l, i) => (i === index ? { ...l, activarCascada: activar, precioVenta: activar ? null : l.precioVenta } : l)),
    );
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
      if (l.precioVenta !== null && l.precioVenta < 0)
        return "El precio de venta no puede ser negativo.";
    }
    return null;
  }

  function registrar() {
    const errorValidacion = validar();
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }
    setError(null);
    setAvisoPrecio(null);
    startTransition(async () => {
      const resultado = await cargarCompraDirecta({
        proveedor_id: proveedorId,
        numero_factura: numeroFactura.trim() || null,
        fecha_factura: fechaFactura || null,
        lineas: lineas.map((l) => ({
          sku_id: l.sku.id,
          cantidad: l.cantidad,
          costo_unitario: l.costoUnitario,
        })),
      });

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }

      const lineasConPrecio = lineas.filter(
        (l): l is Linea & { precioVenta: number } => l.precioVenta !== null,
      );
      const lineasConCascada = lineas.filter((l) => l.activarCascada);

      const [resultadosPrecio, resultadosCascada] = await Promise.all([
        Promise.all(lineasConPrecio.map((l) => guardarPrecioBase(l.sku.id, l.precioVenta))),
        Promise.all(lineasConCascada.map((l) => activarCascadaCerveza(l.sku.id))),
      ]);

      const fallosPrecio = lineasConPrecio
        .map((l, i) => ({ linea: l, resultado: resultadosPrecio[i] }))
        .filter((f) => "error" in f.resultado);
      const fallosCascada = lineasConCascada
        .map((l, i) => ({ linea: l, resultado: resultadosCascada[i] }))
        .filter((f) => "error" in f.resultado);

      setLineas([]);
      setNumeroFactura("");
      setFechaFactura("");
      setProveedorId("");

      if (fallosPrecio.length > 0 || fallosCascada.length > 0) {
        setCompraCreadaId(resultado.id);
        const partes: string[] = [];
        if (fallosPrecio.length > 0) {
          partes.push(
            `no se pudo guardar el precio de: ${fallosPrecio
              .map((f) => f.linea.sku.producto?.nombre ?? f.linea.sku.codigo_interno)
              .join(", ")}`,
          );
        }
        if (fallosCascada.length > 0) {
          partes.push(
            `no se pudo activar la cascada de: ${fallosCascada
              .map((f) => f.linea.sku.producto?.nombre ?? f.linea.sku.codigo_interno)
              .join(", ")}`,
          );
        }
        setAvisoPrecio(`La compra se registró bien, pero ${partes.join("; ")}. Revisalo desde Precios.`);
        return;
      }

      router.push(`/compras/${resultado.id}`);
    });
  }

  return (
    <div className="mx-auto max-w-[880px] rounded-card border border-border bg-bg p-5">
      <h2 className="mb-1 text-[14px] font-semibold text-text">Cargar mercadería</h2>
      <p className="mb-4 text-[12.5px] text-text-3">
        Para cuando llega todo junto: elegí el proveedor, cargá lo que entró, el costo y —si
        corresponde definirlo ahora— el precio de venta, y queda todo actualizado (compra, stock,
        costo y precio) en un solo paso. Si el proveedor va a mandar el resto más adelante, usá
        &quot;Nueva compra&quot; en cambio. Los SKU con cascada de cerveza en lata calculan su
        precio solos: si cargás uno acá, el precio de venta se ignora.
      </p>

      {avisoPrecio && (
        <div className="mb-4 rounded-[6px] border border-warn/40 bg-warn-bg px-[12px] py-[9px] text-[12.5px] text-warn">
          <p>{avisoPrecio}</p>
          {compraCreadaId && (
            <button
              type="button"
              onClick={() => router.push(`/compras/${compraCreadaId}`)}
              className="mt-1 font-medium underline"
            >
              Ir a la compra
            </button>
          )}
        </div>
      )}

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
        <label className={labelClass}>Agregar producto</label>
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
              <th className="w-[140px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Precio de venta
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
                <td colSpan={6} className="px-[12px] py-[16px] text-center text-[12.5px] text-text-3">
                  Todavía no agregaste productos.
                </td>
              </tr>
            ) : (
              lineas.map((l, i) => {
                const ofreceCascada = cascadaOfrecidaIds.has(l.sku.id);
                const preview = ofreceCascada ? calcularCascadaCerveza(l.costoUnitario || 0) : null;
                return (
                  <Fragment key={l.sku.id}>
                    <tr className="border-b border-[#F1F1F3] last:border-b-0">
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
                      <td className="px-[12px] py-[7px] align-middle">
                        {l.activarCascada ? (
                          <span className="block text-right text-[12px] text-text-3">Automático</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Opcional"
                            className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none placeholder:text-text-3 focus:border-moe"
                            value={l.precioVenta ?? ""}
                            onChange={(e) =>
                              actualizarLinea(
                                i,
                                "precioVenta",
                                e.target.value === "" ? null : Number(e.target.value),
                              )
                            }
                          />
                        )}
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
                    {ofreceCascada && (
                      <tr className="border-b border-[#F1F1F3] bg-info-bg/40 last:border-b-0">
                        <td colSpan={6} className="px-[12px] py-[8px]">
                          <label className="flex flex-wrap items-center gap-2 text-[12px] text-text-2">
                            <input
                              type="checkbox"
                              checked={l.activarCascada}
                              onChange={(e) => alternarCascada(i, e.target.checked)}
                            />
                            <span>
                              Activar cascada de cerveza en lata para esta familia — con este costo, el x6 y
                              la unidad van a quedar en:
                            </span>
                            {preview && (
                              <span className="font-medium text-text">
                                Olavarría x24 {formatoMoneda.format(preview.x24Olavarria)} · x6{" "}
                                {formatoMoneda.format(preview.x6Olavarria)} · unidad{" "}
                                {formatoMoneda.format(preview.unidadOlavarria)} — Laprida x6{" "}
                                {formatoMoneda.format(preview.x6Laprida)} · unidad{" "}
                                {formatoMoneda.format(preview.unidadLaprida)}
                              </span>
                            )}
                          </label>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
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

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={registrar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Registrando…" : "Registrar mercadería"}
        </button>
      </div>
    </div>
  );
}
