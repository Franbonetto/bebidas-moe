"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { coincideFragmentos } from "@/lib/promociones";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { usePinOperaciones } from "@/app/(app)/_components/pin-gate";
import { registrarPrestamo } from "../actions";

export type SkuPrestamo = {
  id: string;
  nombre: string;
  marcaNombre: string | null;
  codigoInterno: string;
  presentacion: SkuPresentacion;
  stock: number;
};

export type ProveedorOpcion = { id: string; label: string };

type ItemCarrito = { skuId: string; cantidad: number };

function textoBusqueda(sku: SkuPrestamo) {
  return `${sku.marcaNombre ?? ""} ${sku.nombre} ${presentacionLabel(sku.presentacion)} ${sku.codigoInterno}`;
}

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[13px] text-text outline-none focus:border-moe";

// Nuevo préstamo a un proveedor (pedido del usuario 2026-10-31): tiquear
// productos como en una venta, pero sin precio ni promo -- es solo
// mercadería que sale y tiene que volver. Pantalla propia y simple a
// propósito: no toca el POS de ventas real.
export function NuevoPrestamoForm({
  skus,
  proveedores,
}: {
  skus: SkuPrestamo[];
  proveedores: ProveedorOpcion[];
}) {
  const router = useRouter();
  const pedirPin = usePinOperaciones();

  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [proveedorId, setProveedorId] = useState(proveedores[0]?.id ?? "");
  const [nota, setNota] = useState("");
  const [fechaEstimada, setFechaEstimada] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resultados = useMemo(() => {
    if (!busqueda.trim()) return [];
    return skus.filter((s) => coincideFragmentos(textoBusqueda(s), busqueda)).slice(0, 8);
  }, [skus, busqueda]);

  const skuPorId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  function agregar(skuId: string) {
    setCarrito((c) => {
      const existe = c.find((i) => i.skuId === skuId);
      if (existe) {
        return c.map((i) => (i.skuId === skuId ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [...c, { skuId, cantidad: 1 }];
    });
    setBusqueda("");
  }

  function cambiarCantidad(skuId: string, cantidad: number) {
    setCarrito((c) => c.map((i) => (i.skuId === skuId ? { ...i, cantidad } : i)));
  }

  function quitar(skuId: string) {
    setCarrito((c) => c.filter((i) => i.skuId !== skuId));
  }

  async function confirmar() {
    setError(null);
    setAviso(null);

    if (!proveedorId) {
      setError("Elegí el proveedor.");
      return;
    }
    if (carrito.length === 0) {
      setError("Agregá al menos un producto.");
      return;
    }
    if (carrito.some((i) => !Number.isInteger(i.cantidad) || i.cantidad <= 0)) {
      setError("Las cantidades tienen que ser números enteros mayores a cero.");
      return;
    }

    const pin = await pedirPin();
    if (!pin) return;

    startTransition(async () => {
      const resultado = await registrarPrestamo(
        proveedorId,
        carrito,
        nota,
        fechaEstimada || null,
        pin,
      );
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      setAviso("Préstamo registrado. El stock ya se descontó.");
      setCarrito([]);
      setNota("");
      setFechaEstimada("");
      router.refresh();
    });
  }

  if (proveedores.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-4 text-[13px] text-text-2">
        No hay proveedores activos cargados. Agregá uno desde /proveedores antes de poder prestar
        mercadería.
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-bg p-4">
      <h2 className="text-[14px] font-semibold text-text">Nuevo préstamo</h2>
      <p className="mt-[2px] text-[12.5px] text-text-2">
        Tiqueá lo que se lleva el proveedor, igual que en una venta. No tiene precio: solo mueve
        stock, y se descuenta ahora mismo.
      </p>

      <div className="relative mt-3">
        <label className="mb-[3px] block text-[12px] font-medium text-text-2">Producto</label>
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, marca o código…"
          className={inputClass}
        />
        {resultados.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-bg shadow-sm">
            {resultados.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => agregar(s.id)}
                className="flex w-full items-center justify-between gap-2 px-[10px] py-[7px] text-left text-[13px] hover:bg-bg-2"
              >
                <span className="text-text">
                  {s.marcaNombre ? `${s.marcaNombre} ` : ""}
                  {s.nombre} · {presentacionLabel(s.presentacion)}
                </span>
                <span className="shrink-0 tabular-nums text-text-3">stock {s.stock}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {carrito.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-[6px] border border-border">
          {carrito.map((item) => {
            const sku = skuPorId.get(item.skuId);
            if (!sku) return null;
            return (
              <div
                key={item.skuId}
                className="flex items-center justify-between gap-2 border-b border-[#F1F1F3] px-[10px] py-[7px] text-[13px] last:border-b-0"
              >
                <span className="text-text">
                  {sku.marcaNombre ? `${sku.marcaNombre} ` : ""}
                  {sku.nombre} · {presentacionLabel(sku.presentacion)}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={item.cantidad}
                    onChange={(e) => cambiarCantidad(item.skuId, Math.max(1, Number(e.target.value)))}
                    className="w-[64px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums text-text outline-none focus:border-moe"
                  />
                  <button
                    type="button"
                    onClick={() => quitar(item.skuId)}
                    className="text-[12.5px] text-text-3 hover:text-err"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-[3px] block text-[12px] font-medium text-text-2">Proveedor</label>
          <select
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
            className={inputClass}
          >
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-[3px] block text-[12px] font-medium text-text-2">
            Vuelve aprox. (opcional)
          </label>
          <input
            type="date"
            value={fechaEstimada}
            onChange={(e) => setFechaEstimada(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-2">
        <label className="mb-[3px] block text-[12px] font-medium text-text-2">Nota (opcional)</label>
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Ej. lo pidió Juan de la distribuidora para completar un evento"
          rows={2}
          className={inputClass}
        />
      </div>

      {error && <p className="mt-2 text-[12.5px] text-err">{error}</p>}
      {aviso && <p className="mt-2 text-[12.5px] text-ok">{aviso}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={confirmar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Registrando…" : "Confirmar préstamo"}
        </button>
      </div>
    </div>
  );
}
