"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { SkuPicker, type SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { actualizarCodigoBarras } from "@/app/(app)/productos/actions";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { datosSkuParaCarga, guardarCargaInicial, type DatosSkuCarga } from "../actions";

type Sucursal = { id: string; nombre: string };

type Cargado = {
  skuId: string;
  nombre: string;
  presentacion: string;
  cantidad: number;
};

// Pantalla pensada para el celular, con el negocio abierto y contando de a
// un producto por vez. Por eso:
//   - los inputs van a 16px: abajo de eso iOS hace zoom al enfocar y te
//     descuadra la pantalla en cada producto;
//   - el foco vuelve solo al buscador después de guardar, para poder
//     escanear el siguiente sin tocar nada;
//   - la cantidad es el TOTAL contado, y siempre se muestra primero lo que
//     el sistema ya tiene, para que se note si ese producto ya se cargó.
const inputClass =
  "w-full rounded-[8px] border border-border bg-bg px-[12px] py-[9px] text-[16px] text-text outline-none focus:border-moe";
const labelClass = "mb-[5px] block text-[12.5px] font-medium text-text-2";

export function CargaInicialForm({
  sucursales,
  skus,
}: {
  sucursales: Sucursal[];
  skus: SkuCatalogo[];
}) {
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [sku, setSku] = useState<SkuCatalogo | null>(null);
  const [datos, setDatos] = useState<DatosSkuCarga | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargados, setCargados] = useState<Cargado[]>([]);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // El SkuPicker maneja su propio input; para devolverle el foco después de
  // guardar se lo busca por su testid en vez de agregarle una prop de ref
  // que solo usaría esta pantalla.
  function enfocarBuscador() {
    const input = contenedorRef.current?.querySelector<HTMLInputElement>(
      '[data-testid="sku-picker-input"]',
    );
    input?.focus();
  }

  useEffect(() => {
    // Cambiar de sucursal con un producto a medias cargaría el conteo en el
    // lugar equivocado: se limpia todo.
    setSku(null);
    setDatos(null);
  }, [sucursalId]);

  async function elegirSku(elegido: SkuCatalogo) {
    setSku(elegido);
    setDatos(null);
    setError(null);
    setCantidad("");
    setCosto("");
    setPrecio("");
    setCargandoDatos(true);
    const resultado = await datosSkuParaCarga(elegido.id, sucursalId);
    setCargandoDatos(false);
    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }
    setDatos(resultado);
    setCosto(resultado.costoActual !== null ? String(resultado.costoActual) : "");
    setPrecio(resultado.precioBase !== null ? String(resultado.precioBase) : "");
  }

  function limpiar() {
    setSku(null);
    setDatos(null);
    setCantidad("");
    setCosto("");
    setPrecio("");
    setError(null);
  }

  async function guardar() {
    if (!sku || !datos) return;
    const cantidadNum = Number(cantidad);
    if (cantidad === "" || !Number.isInteger(cantidadNum) || cantidadNum < 0) {
      setError("Escribí cuántas unidades contaste (0 o más, sin decimales).");
      return;
    }
    if (datos.precioBase === null && precio === "") {
      setError("Este producto todavía no tiene precio de venta: cargalo ahora.");
      return;
    }

    setError(null);
    setGuardando(true);
    const resultado = await guardarCargaInicial({
      sku_id: sku.id,
      sucursal_id: sucursalId,
      cantidad: cantidadNum,
      costo: costo === "" ? null : Number(costo),
      precio: precio === "" ? null : Number(precio),
    });
    setGuardando(false);

    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }

    setCargados((prev) => [
      {
        skuId: sku.id,
        nombre: sku.producto?.nombre ?? sku.codigo_interno,
        presentacion: presentacionLabel(sku),
        cantidad: resultado.stock,
      },
      ...prev,
    ]);
    limpiar();
    enfocarBuscador();
  }

  const yaCargadoEnSesion = sku ? cargados.some((c) => c.skuId === sku.id) : false;

  return (
    <div ref={contenedorRef} className="mx-auto flex max-w-[560px] flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-[15px]">
        <h1 className="text-[15px] font-semibold text-text">Carga inicial de stock</h1>
        <p className="mt-[3px] text-[12.5px] leading-[1.5] text-text-3">
          De a un producto por vez. Contá todo lo que haya de ese producto en la sucursal —depósito
          y góndola juntos— y cargá el total. Si lo cargás dos veces, el segundo número corrige al
          primero: no se suma.
        </p>

        {sucursales.length > 1 && (
          <div className="mt-3">
            <label className={labelClass}>Sucursal</label>
            <select
              className={inputClass}
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rounded-card border border-border bg-bg p-[15px]">
        <label className={labelClass}>Producto</label>
        <SkuPicker
          skus={skus}
          excluirIds={new Set()}
          onSelect={elegirSku}
          onAsignarCodigoBarras={actualizarCodigoBarras}
        />
        <p className="mt-2 text-[12px] text-text-3">
          Escaneá el código con la pistola o buscá por nombre.{" "}
          <Link href="/productos/nuevo" className="font-medium text-moe hover:underline">
            ¿No está en el sistema? Darlo de alta
          </Link>
        </p>

        {cargandoDatos && <p className="mt-3 text-[12.5px] text-text-3">Buscando el producto…</p>}

        {sku && datos && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-[14px] font-semibold text-text">
              {sku.producto?.nombre ?? sku.codigo_interno}
            </p>
            <p className="text-[12.5px] text-text-3">
              {[sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — ")}
            </p>

            {!datos.codigoBarras && (
              <p className="mt-2 rounded-[6px] border border-warn/40 bg-warn-bg px-[10px] py-[7px] text-[12.5px] text-warn">
                Sin código de barras. Escaneálo en el buscador de arriba y elegí este producto para
                asignárselo — después va a entrar solo en el punto de venta.
              </p>
            )}

            <div
              className={`mt-3 rounded-[6px] px-[10px] py-[8px] text-[12.5px] ${
                datos.stockActual > 0 || yaCargadoEnSesion
                  ? "bg-warn-bg text-warn"
                  : "bg-bg-2 text-text-2"
              }`}
            >
              {datos.stockActual > 0 || yaCargadoEnSesion ? (
                <>
                  Ojo: el sistema ya tiene <b>{datos.stockActual}</b> de este producto en esta
                  sucursal. Si ya lo contaste antes, lo que escribas ahora lo reemplaza.
                </>
              ) : (
                <>El sistema todavía no tiene stock de este producto acá.</>
              )}
            </div>

            <div className="mt-3">
              <label className={labelClass}>Cantidad contada (total en la sucursal) *</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                autoFocus
                className={`${inputClass} tabular-nums`}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Costo unitario</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="Opcional"
                  className={`${inputClass} tabular-nums`}
                  value={costo}
                  onChange={(e) => setCosto(e.target.value)}
                />
                <p className="mt-[3px] text-[11.5px] text-text-3">
                  {datos.costoActual !== null
                    ? `Cargado: ${formatoMoneda.format(datos.costoActual)}`
                    : "Si no te acordás, dejalo vacío"}
                </p>
              </div>
              <div>
                <label className={labelClass}>
                  Precio de venta {datos.precioBase === null && "*"}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder={datos.precioBase === null ? "Obligatorio" : ""}
                  className={`${inputClass} tabular-nums ${
                    datos.precioBase === null ? "border-warn/50" : ""
                  }`}
                  value={precio}
                  onChange={(e) => setPrecio(e.target.value)}
                />
                <p className="mt-[3px] text-[11.5px] text-text-3">
                  {datos.precioBase !== null
                    ? `Cargado: ${formatoMoneda.format(datos.precioBase)}`
                    : "Sin precio no se puede vender"}
                </p>
              </div>
            </div>

            {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="flex-1 rounded-[8px] bg-moe px-[14px] py-[10px] text-[15px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Guardar y seguir"}
              </button>
              <button
                type="button"
                onClick={limpiar}
                className="text-[13px] text-text-3 hover:text-text"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!sku && error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}
      </div>

      {cargados.length > 0 && (
        <div className="overflow-hidden rounded-card border border-border bg-bg">
          <div className="flex items-center justify-between border-b border-border px-[14px] py-[10px]">
            <h2 className="text-[13px] font-semibold text-text">Cargados recién</h2>
            <span className="text-[12px] text-text-3">
              {cargados.length} producto{cargados.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-col">
            {cargados.slice(0, 15).map((c, i) => (
              <div
                key={`${c.skuId}:${i}`}
                className="flex items-center justify-between gap-3 border-b border-[#F1F1F3] px-[14px] py-[8px] last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-text">{c.nombre}</span>
                  <span className="block text-[11.5px] text-text-3">{c.presentacion}</span>
                </span>
                <span className="shrink-0 text-[14px] font-medium tabular-nums text-text">
                  {c.cantidad}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
