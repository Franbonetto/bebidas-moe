"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmarDevolucion, type CambioItemInput } from "../../../actions";
import { SkuPicker, type SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { presentacionLabel } from "@/app/(app)/productos/_lib/presentacion";
import { formatoMoneda } from "../../../_lib/formato";

export type VentaItemRow = {
  id: string;
  skuId: string;
  nombre: string;
  marcaNombre: string | null;
  presentacion: string;
  cantidadVendida: number;
  cantidadYaDevuelta: number;
  precioUnitario: number;
};

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const modoBtnClass = (activo: boolean) =>
  `rounded-[6px] border px-[10px] py-[5px] text-[12.5px] font-medium ${
    activo ? "border-moe bg-moe-soft text-moe" : "border-border bg-bg text-text-2 hover:bg-bg-2"
  }`;

type FilaEstado = { cantidad: string; destino: "stock" | "merma" };
type CambioFila = { sku: SkuCatalogo; cantidad: string };

export function DevolucionForm({
  ventaId,
  items,
  skus,
}: {
  ventaId: string;
  items: VentaItemRow[];
  skus: SkuCatalogo[];
}) {
  const router = useRouter();
  const [estados, setEstados] = useState<Record<string, FilaEstado>>(() =>
    Object.fromEntries(items.map((it) => [it.id, { cantidad: "0", destino: "stock" as const }])),
  );
  const [resolucion, setResolucion] = useState<"dinero" | "cambio">("dinero");
  const [cambioFilas, setCambioFilas] = useState<CambioFila[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const excluirIdsCambio = useMemo(() => new Set(cambioFilas.map((f) => f.sku.id)), [cambioFilas]);

  function actualizarFila(id: string, campo: "cantidad" | "destino", valor: string) {
    setEstados((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));
  }

  function agregarCambio(sku: SkuCatalogo) {
    setCambioFilas((prev) => [...prev, { sku, cantidad: "1" }]);
  }

  function actualizarCambio(index: number, cantidad: string) {
    setCambioFilas((prev) => prev.map((f, i) => (i === index ? { ...f, cantidad } : f)));
  }

  function quitarCambio(index: number) {
    setCambioFilas((prev) => prev.filter((_, i) => i !== index));
  }

  const itemsSeleccionados = items
    .map((it) => ({ item: it, cantidad: Number(estados[it.id]?.cantidad ?? "0") }))
    .filter((f) => f.cantidad > 0);

  const montoAReembolsar = itemsSeleccionados.reduce(
    (acc, f) => acc + f.cantidad * f.item.precioUnitario,
    0,
  );

  function validar(): string | null {
    if (itemsSeleccionados.length === 0) return "Elegí al menos un producto para devolver.";

    for (const it of items) {
      const cantidad = Number(estados[it.id]?.cantidad ?? "0");
      const disponible = it.cantidadVendida - it.cantidadYaDevuelta;
      if (!Number.isInteger(cantidad) || cantidad < 0) return `Cantidad inválida para ${it.nombre}.`;
      if (cantidad > disponible) return `No podés devolver más de ${disponible} de ${it.nombre}.`;
    }

    if (resolucion === "cambio") {
      if (cambioFilas.length === 0) return "El cambio necesita al menos un producto de reemplazo.";
      for (const f of cambioFilas) {
        const cantidad = Number(f.cantidad);
        if (!Number.isInteger(cantidad) || cantidad <= 0)
          return "La cantidad de cada producto de reemplazo tiene que ser un entero mayor a cero.";
      }
    }

    return null;
  }

  function confirmar() {
    const errorValidacion = validar();
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }
    setError(null);

    const cambioItems: CambioItemInput[] = cambioFilas.map((f) => ({
      skuId: f.sku.id,
      cantidad: Number(f.cantidad),
    }));

    startTransition(async () => {
      const resultado = await confirmarDevolucion({
        ventaId,
        items: itemsSeleccionados.map((f) => ({
          ventaItemId: f.item.id,
          cantidad: f.cantidad,
          destino: estados[f.item.id].destino,
        })),
        resolucion,
        cambioItems,
        observaciones: observaciones.trim() || null,
      });

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }

      router.push("/vender/devoluciones");
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-center text-[13px] text-text-2">
        Esta venta ya no tiene productos disponibles para devolver — todo lo vendido ya fue devuelto antes.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-4">
        <h2 className="mb-3 text-[13px] font-semibold text-text">Productos de la venta</h2>
        <div className="flex flex-col gap-3">
          {items.map((it) => {
            const disponible = it.cantidadVendida - it.cantidadYaDevuelta;
            const estado = estados[it.id];
            return (
              <div key={it.id} className="grid grid-cols-[1fr_90px_140px] items-center gap-2 border-b border-[#F1F1F3] pb-3 last:border-b-0 last:pb-0">
                <div>
                  <p className="text-[13px] font-medium text-text">{it.nombre}</p>
                  <p className="text-[11.5px] text-text-3">
                    {it.marcaNombre} — {it.presentacion} · Vendido {it.cantidadVendida}
                    {it.cantidadYaDevuelta > 0 ? ` · Ya devuelto ${it.cantidadYaDevuelta}` : ""} · Disponible{" "}
                    {disponible}
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={disponible}
                  value={estado.cantidad}
                  onChange={(e) => actualizarFila(it.id, "cantidad", e.target.value)}
                  className={inputClass}
                />
                <select
                  value={estado.destino}
                  onChange={(e) => actualizarFila(it.id, "destino", e.target.value)}
                  className={inputClass}
                  disabled={Number(estado.cantidad) === 0}
                >
                  <option value="stock">Reingresa a stock</option>
                  <option value="merma">Va a merma</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-card border border-border bg-bg p-4">
        <h2 className="mb-3 text-[13px] font-semibold text-text">Resolución</h2>
        <div className="mb-3 flex gap-2">
          <button type="button" className={modoBtnClass(resolucion === "dinero")} onClick={() => setResolucion("dinero")}>
            Devolver dinero
          </button>
          <button type="button" className={modoBtnClass(resolucion === "cambio")} onClick={() => setResolucion("cambio")}>
            Cambio por otro producto
          </button>
        </div>

        {resolucion === "dinero" ? (
          <p className="text-[13px] text-text-2">
            Monto a reembolsar en efectivo:{" "}
            <span className="font-medium tabular-nums text-text">{formatoMoneda.format(montoAReembolsar)}</span>
            <br />
            <span className="text-[11.5px] text-text-3">
              Se descuenta de la caja de hoy de esta sucursal — hace falta tenerla abierta.
            </span>
          </p>
        ) : (
          <div className="space-y-2">
            {cambioFilas.map((f, index) => (
              <div key={f.sku.id} className="grid grid-cols-[1fr_100px_auto] items-center gap-2">
                <span className="truncate text-[13px] text-text">
                  {f.sku.producto?.nombre}
                  <span className="text-text-3"> · {f.sku.producto?.marca?.nombre} — {presentacionLabel(f.sku)}</span>
                </span>
                <input
                  type="number"
                  min={1}
                  value={f.cantidad}
                  onChange={(e) => actualizarCambio(index, e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => quitarCambio(index)}
                  className="rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[12.5px] text-text-3 hover:bg-bg-2 hover:text-err"
                >
                  Quitar
                </button>
              </div>
            ))}
            <SkuPicker skus={skus} excluirIds={excluirIdsCambio} onSelect={agregarCambio} />
            <p className="text-[11.5px] text-text-3">
              No se calcula diferencia de precio entre lo devuelto y lo nuevo — es un cambio de producto,
              no una venta.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-card border border-border bg-bg p-4">
        <label className="mb-1 block text-[12px] font-medium text-text-2">Observaciones (opcional)</label>
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={2}
          className={inputClass}
          placeholder="Ej. producto vencido, cliente pidió otro sabor…"
        />
      </div>

      {error && <p className="text-[12.5px] text-err">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/vender/devoluciones")}
          disabled={pending}
          className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Confirmando…" : "Confirmar devolución"}
        </button>
      </div>
    </div>
  );
}
