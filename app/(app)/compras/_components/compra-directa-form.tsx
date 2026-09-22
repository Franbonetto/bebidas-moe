"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { cargarCompraDirecta } from "../actions";
import { guardarPrecioBase } from "@/app/(app)/precios/actions";
import { actualizarCodigoBarras } from "@/app/(app)/productos/actions";
import { formatoMoneda } from "../_lib/formato";
import { SkuPicker, type SkuCatalogo } from "./sku-picker";

type Proveedor = { id: string; razon_social: string; nombre_comercial: string | null };
type CostoReferencia = { proveedor_id: string; sku_id: string; costo_referencia: number | null };

type Linea = {
  sku: SkuCatalogo;
  cantidad: number;
  costoUnitario: number;
  precioVenta: number | null;
  // Familia (x24 -> x6 -> unidad, ver desarma_en_sku_id): al agregar un
  // pack, el resto de su familia aparece acá solo para cargarle el precio
  // de venta ahí mismo -- no entra como línea de compra real (nada de eso
  // se contó físicamente hoy), así que no tiene cantidad ni costo.
  soloPrecio: boolean;
};

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

export function CompraDirectaForm({
  proveedores,
  skus,
  costosReferencia,
}: {
  proveedores: Proveedor[];
  skus: SkuCatalogo[];
  costosReferencia: CostoReferencia[];
}) {
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

  // Mapa completo de la cadena de desarme (x24 -> x6 -> unidad) para poder
  // encontrar TODA la familia de un SKU sin importar por cuál se entra --
  // hijoId -> padreId es la inversa de desarma_en_sku_id (que va de grande
  // a chico).
  const skuPorId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const padrePorHijoId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const s of skus) {
      if (s.desarma_en_sku_id) mapa.set(s.desarma_en_sku_id, s.id);
    }
    return mapa;
  }, [skus]);

  // Sube hasta el tope de la cadena (el x24) y despues baja recolectando
  // todos los niveles -- así da lo mismo agregar por el x24, el x6 o la
  // unidad, siempre aparece la familia completa.
  function familiaCompleta(skuId: string): SkuCatalogo[] {
    let tope = skuId;
    while (padrePorHijoId.has(tope)) tope = padrePorHijoId.get(tope)!;

    const familia: SkuCatalogo[] = [];
    let actualId: string | null = tope;
    while (actualId) {
      const actual = skuPorId.get(actualId);
      if (!actual) break;
      familia.push(actual);
      actualId = actual.desarma_en_sku_id ?? null;
    }
    return familia;
  }

  function costoSugerido(skuId: string): number {
    if (!proveedorId) return 0;
    const referencia = costosReferencia.find(
      (c) => c.proveedor_id === proveedorId && c.sku_id === skuId,
    );
    return referencia?.costo_referencia ?? 0;
  }

  // Reescanear un código de barras ya cargado suma 1 a esa línea en vez de
  // duplicarla (el picker deja pasar el match aunque esté en excluirIds,
  // justamente para este caso). Si el SKU es parte de una cascada de
  // desarme, el resto de la familia (ej. al cargar el x24, también el x6 y
  // la unidad) aparece junto para poder cargarle el precio de venta ahí
  // mismo, sin tener que buscarlos aparte (pedido del usuario 2026-09-22).
  function agregarLinea(sku: SkuCatalogo) {
    setLineas((prev) => {
      const idx = prev.findIndex((l) => l.sku.id === sku.id);
      let siguiente: Linea[];
      if (idx >= 0) {
        siguiente = [...prev];
        siguiente[idx] = siguiente[idx].soloPrecio
          ? { ...siguiente[idx], soloPrecio: false, cantidad: 1, costoUnitario: costoSugerido(sku.id) }
          : { ...siguiente[idx], cantidad: siguiente[idx].cantidad + 1 };
      } else {
        siguiente = [
          ...prev,
          { sku, cantidad: 1, costoUnitario: costoSugerido(sku.id), precioVenta: null, soloPrecio: false },
        ];
      }

      const idsPresentes = new Set(siguiente.map((l) => l.sku.id));
      for (const familiar of familiaCompleta(sku.id)) {
        if (!idsPresentes.has(familiar.id)) {
          siguiente.push({ sku: familiar, cantidad: 0, costoUnitario: 0, precioVenta: null, soloPrecio: true });
          idsPresentes.add(familiar.id);
        }
      }
      return siguiente;
    });
  }

  function actualizarLinea(
    index: number,
    campo: "cantidad" | "costoUnitario" | "precioVenta",
    valor: number | null,
  ) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, [campo]: valor } : l)));
  }

  function quitarLinea(index: number) {
    setLineas((prev) => prev.filter((_, i) => i !== index));
  }

  function validar(): string | null {
    if (!proveedorId) return "Elegí un proveedor.";
    const lineasReales = lineas.filter((l) => !l.soloPrecio);
    if (lineasReales.length === 0) return "Agregá al menos una línea.";
    for (const l of lineasReales) {
      if (!Number.isInteger(l.cantidad) || l.cantidad <= 0)
        return "La cantidad tiene que ser un entero mayor a cero.";
      if (l.costoUnitario < 0) return "El costo unitario no puede ser negativo.";
    }
    for (const l of lineas) {
      if (l.precioVenta === null)
        return `Cargá el precio de venta de ${l.sku.producto?.nombre ?? l.sku.codigo_interno} — ${presentacionLabel(l.sku)}.`;
      if (l.precioVenta < 0) return "El precio de venta no puede ser negativo.";
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
        lineas: lineas
          .filter((l) => !l.soloPrecio)
          .map((l) => ({
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
      const resultadosPrecio = await Promise.all(
        lineasConPrecio.map((l) => guardarPrecioBase(l.sku.id, l.precioVenta)),
      );
      const fallos = lineasConPrecio
        .map((l, i) => ({ linea: l, resultado: resultadosPrecio[i] }))
        .filter((f) => "error" in f.resultado);

      setLineas([]);
      setNumeroFactura("");
      setFechaFactura("");
      setProveedorId("");

      if (fallos.length > 0) {
        setCompraCreadaId(resultado.id);
        setAvisoPrecio(
          `La compra se registró bien, pero no se pudo guardar el precio de: ${fallos
            .map((f) => f.linea.sku.producto?.nombre ?? f.linea.sku.codigo_interno)
            .join(", ")}. Cargalo desde Precios.`,
        );
        return;
      }

      router.push(`/compras/${resultado.id}`);
    });
  }

  return (
    <div className="mx-auto max-w-[880px] rounded-card border border-border bg-bg p-5">
      <h2 className="mb-1 text-[14px] font-semibold text-text">Cargar mercadería</h2>
      <p className="mb-4 text-[12.5px] text-text-3">
        Elegí el proveedor, cargá lo que entró, el costo y el precio de venta, y queda todo
        actualizado (compra, stock, costo y precio) en un solo paso. Cada presentación (x24, x6,
        unidad) tiene su propio precio, siempre cargado a mano y obligatorio. Si agregás un pack
        que se desarma, el resto de la familia aparece abajo para cargarle el precio ahí mismo.
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
              lineas.map((l, i) => (
                <tr
                  key={l.sku.id}
                  className={`border-b border-[#F1F1F3] last:border-b-0 ${l.soloPrecio ? "bg-bg-2/40" : ""}`}
                >
                  <td className="px-[12px] py-[7px] align-middle">
                    <p className="font-medium text-text">{l.sku.producto?.nombre}</p>
                    <p className="text-[11.5px] text-text-3">
                      {l.sku.producto?.marca?.nombre} — {presentacionLabel(l.sku)}
                    </p>
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    {l.soloPrecio ? (
                      <span className="block text-right text-[12.5px] text-text-3">—</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                        value={l.cantidad}
                        onChange={(e) => actualizarLinea(i, "cantidad", Number(e.target.value))}
                      />
                    )}
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    {l.soloPrecio ? (
                      <span className="block text-right text-[12.5px] text-text-3">—</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                        value={l.costoUnitario}
                        onChange={(e) => actualizarLinea(i, "costoUnitario", Number(e.target.value))}
                      />
                    )}
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Obligatorio"
                      className={`w-full rounded-[6px] border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none placeholder:text-text-3 focus:border-moe ${
                        l.precioVenta === null ? "border-warn/50" : "border-border"
                      }`}
                      value={l.precioVenta ?? ""}
                      onChange={(e) =>
                        actualizarLinea(
                          i,
                          "precioVenta",
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </td>
                  <td className="px-[12px] py-[7px] text-right align-middle tabular-nums text-text">
                    {l.soloPrecio ? "—" : formatoMoneda.format(l.cantidad * l.costoUnitario)}
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
