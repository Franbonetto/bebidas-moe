"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { SkuPicker, type SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { actualizarCodigoBarras } from "@/app/(app)/productos/actions";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import {
  fechaVencimientoAIso,
  fechaVencimientoDesdeIso,
  fechaVencimientoValida,
  formatearFechaVencimiento,
} from "@/app/(app)/compras/_lib/vencimiento";
import { datosSkuParaCarga, guardarCargaInicial, type DatosSkuCarga } from "../actions";
import { EscanerCamara, soportaEscanerCamara } from "./escaner-camara";

type Sucursal = { id: string; nombre: string };
type Proveedor = { id: string; razon_social: string; nombre_comercial: string | null };

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

function sumaLotesExtra(lotes: { cantidad: string }[]): number {
  return lotes.reduce((acc, l) => acc + Number(l.cantidad || 0), 0);
}

export function CargaInicialForm({
  sucursales,
  proveedores,
  skus,
}: {
  sucursales: Sucursal[];
  proveedores: Proveedor[];
  skus: SkuCatalogo[];
}) {
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [sku, setSku] = useState<SkuCatalogo | null>(null);
  const [datos, setDatos] = useState<DatosSkuCarga | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  // Segundo vencimiento en adelante: {cantidad, fecha} por lote. Vacío =
  // una sola fecha (el caso normal), que usa el campo de arriba.
  const [lotes, setLotes] = useState<{ cantidad: string; fecha: string }[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [stockMinimo, setStockMinimo] = useState("");
  const [stockObjetivo, setStockObjetivo] = useState("");
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [avisoEscaneo, setAvisoEscaneo] = useState<string | null>(null);
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

  // Se resuelve en el cliente y sin efecto: en el servidor no hay cámara, y
  // el botón no tiene que aparecer en iPhone (Safari no trae el lector
  // nativo). useSyncExternalStore evita el parpadeo de hidratación que daría
  // leerlo en el primer render.
  const hayCamara = useSyncExternalStore(
    () => () => {},
    () => soportaEscanerCamara(),
    () => false,
  );

  function cambiarSucursal(id: string) {
    // Cambiar de sucursal con un producto a medias cargaría el conteo en el
    // lugar equivocado: se limpia todo.
    setSucursalId(id);
    setSku(null);
    setDatos(null);
    limpiar();
  }

  // La cámara devuelve el código crudo: se busca igual que la pistola, por
  // codigo_barras exacto. Si no matchea no se inventa nada -- se avisa y se
  // sigue a mano.
  const elegirPorCodigo = useCallback(
    (codigo: string) => {
      const encontrado = skus.find((s) => s.codigo_barras === codigo);
      if (!encontrado) {
        setAvisoEscaneo(`Leímos ${codigo}, pero no hay ningún producto con ese código todavía.`);
        return;
      }
      setAvisoEscaneo(null);
      setCamaraAbierta(false);
      elegirSku(encontrado);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skus, sucursalId],
  );

  async function elegirSku(elegido: SkuCatalogo) {
    setSku(elegido);
    setDatos(null);
    setError(null);
    setCantidad("");
    setCosto("");
    setPrecio("");
    setVencimiento("");
    setLotes([]);
    setProveedorId("");
    setStockMinimo("");
    setStockObjetivo("");
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
    setVencimiento(fechaVencimientoDesdeIso(resultado.vencimientoUltimoLote));
    setProveedorId(resultado.proveedorId ?? "");
    setStockMinimo(String(resultado.stockMinimo));
    setStockObjetivo(String(resultado.stockObjetivo));
  }

  function limpiar() {
    setSku(null);
    setDatos(null);
    setCantidad("");
    setCosto("");
    setPrecio("");
    setVencimiento("");
    setLotes([]);
    setProveedorId("");
    setStockMinimo("");
    setStockObjetivo("");
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
    if (!fechaVencimientoValida(vencimiento)) {
      setError("El vencimiento tiene que ser dd/mm/aaaa, o quedar vacío.");
      return;
    }
    for (const lote of lotes) {
      if (!fechaVencimientoValida(lote.fecha) || !lote.fecha) {
        setError("Cada vencimiento necesita su fecha en dd/mm/aaaa.");
        return;
      }
      if (lote.cantidad === "" || Number(lote.cantidad) <= 0) {
        setError("Cada vencimiento necesita una cantidad mayor a cero.");
        return;
      }
    }
    if (lotes.length > 0 && sumaLotes !== cantidadNum) {
      setError(`Los vencimientos suman ${sumaLotes} y contaste ${cantidadNum}: tienen que dar igual.`);
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
      lotes: lotesParaGuardar,
      proveedor_id: proveedorId || null,
      stock_minimo: stockMinimo === "" ? null : Number(stockMinimo),
      stock_objetivo: stockObjetivo === "" ? null : Number(stockObjetivo),
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

  // Con "Dividir" abierto, la primera fila es el campo de arriba: el total
  // se reparte entre todas las fechas y tiene que cerrar contra lo contado.
  const cantidadPrimerLote = lotes.length > 0 ? Number(cantidad || 0) - sumaLotesExtra(lotes) : 0;
  const sumaLotes = lotes.length > 0 ? cantidadPrimerLote + sumaLotesExtra(lotes) : 0;
  const lotesParaGuardar =
    lotes.length > 0
      ? [
          { cantidad: cantidadPrimerLote, fecha_vencimiento: fechaVencimientoAIso(vencimiento)! },
          ...lotes.map((l) => ({
            cantidad: Number(l.cantidad),
            fecha_vencimiento: fechaVencimientoAIso(l.fecha)!,
          })),
        ]
      : vencimiento && Number(cantidad || 0) > 0
        ? [{ cantidad: Number(cantidad || 0), fecha_vencimiento: fechaVencimientoAIso(vencimiento)! }]
        : [];

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
              onChange={(e) => cambiarSucursal(e.target.value)}
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
        {hayCamara && (
          <button
            type="button"
            onClick={() => {
              setAvisoEscaneo(null);
              setCamaraAbierta((abierta) => !abierta);
            }}
            className="mt-2 w-full rounded-[8px] border border-border bg-bg-2 py-[9px] text-[13.5px] font-medium text-text-2"
          >
            {camaraAbierta ? "Cerrar cámara" : "Escanear con la cámara"}
          </button>
        )}

        {camaraAbierta && (
          <EscanerCamara onCodigo={elegirPorCodigo} onCerrar={() => setCamaraAbierta(false)} />
        )}

        {avisoEscaneo && (
          <p className="mt-2 rounded-[6px] border border-warn/40 bg-warn-bg px-[10px] py-[7px] text-[12.5px] text-warn">
            {avisoEscaneo} Buscalo por nombre y asignale el código después, con la pistola del
            mostrador.
          </p>
        )}

        <p className="mt-2 text-[12px] text-text-3">
          Escaneá con la pistola o buscá por nombre.{" "}
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

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Vencimiento</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="dd/mm/aaaa"
                  maxLength={10}
                  className={`${inputClass} tabular-nums`}
                  value={vencimiento}
                  onChange={(e) => setVencimiento(formatearFechaVencimiento(e.target.value))}
                />
                {lotes.length === 0 ? (
                  <p className="mt-[3px] text-[11.5px] text-text-3">
                    Solo si el producto vence.{" "}
                    {vencimiento && (
                      <button
                        type="button"
                        onClick={() => setLotes([{ cantidad: "", fecha: "" }])}
                        className="font-medium text-moe hover:underline"
                      >
                        ¿Hay más de una fecha?
                      </button>
                    )}
                  </p>
                ) : (
                  <p className="mt-[3px] text-[11.5px] text-text-3">
                    {cantidadPrimerLote > 0 ? `${cantidadPrimerLote} u.` : "—"} con esta fecha
                  </p>
                )}
              </div>
              <div>
                <label className={labelClass}>Proveedor</label>
                <select
                  className={inputClass}
                  value={proveedorId}
                  onChange={(e) => setProveedorId(e.target.value)}
                >
                  <option value="">Sin definir</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre_comercial ?? p.razon_social}
                    </option>
                  ))}
                </select>
                <p className="mt-[3px] text-[11.5px] text-text-3">
                  A quién le comprás este producto
                </p>
              </div>
            </div>

            {lotes.length > 0 && (
              <div className="mt-3 rounded-[8px] border border-border bg-bg-2 p-3">
                <p className="mb-2 text-[12px] text-text-2">
                  Repartí lo que contaste entre las fechas. La suma tiene que dar{" "}
                  <b className="font-medium">{cantidad || 0}</b>.
                </p>
                <div className="flex flex-col gap-2">
                  {lotes.map((lote, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        placeholder="Cant."
                        className={`${inputClass} w-[90px] tabular-nums`}
                        value={lote.cantidad}
                        onChange={(e) =>
                          setLotes((prev) =>
                            prev.map((l, j) => (j === i ? { ...l, cantidad: e.target.value } : l)),
                          )
                        }
                      />
                      <span className="text-[12.5px] text-text-3">vencen</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="dd/mm/aaaa"
                        maxLength={10}
                        className={`${inputClass} flex-1 tabular-nums`}
                        value={lote.fecha}
                        onChange={(e) =>
                          setLotes((prev) =>
                            prev.map((l, j) =>
                              j === i ? { ...l, fecha: formatearFechaVencimiento(e.target.value) } : l,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setLotes((prev) => prev.filter((_, j) => j !== i))}
                        className="text-[12px] text-text-3 hover:text-err"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setLotes((prev) => [...prev, { cantidad: "", fecha: "" }])}
                    className="text-[12.5px] font-medium text-moe hover:underline"
                  >
                    + Otra fecha
                  </button>
                  <span
                    className={`text-[12.5px] tabular-nums ${
                      sumaLotes === Number(cantidad || 0) ? "text-ok" : "text-warn"
                    }`}
                  >
                    Suman {sumaLotes} de {cantidad || 0}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Stock mínimo</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  className={`${inputClass} tabular-nums`}
                  value={stockMinimo}
                  onChange={(e) => setStockMinimo(e.target.value)}
                />
                <p className="mt-[3px] text-[11.5px] text-text-3">
                  Con menos que esto, salta la alerta
                </p>
              </div>
              <div>
                <label className={labelClass}>Stock objetivo</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  className={`${inputClass} tabular-nums`}
                  value={stockObjetivo}
                  onChange={(e) => setStockObjetivo(e.target.value)}
                />
                <p className="mt-[3px] text-[11.5px] text-text-3">
                  Cuánto querés tener cuando reponés
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
