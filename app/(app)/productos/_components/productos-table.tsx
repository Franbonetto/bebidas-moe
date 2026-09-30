"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { presentacionLabel } from "../_lib/presentacion";
import { useRouter } from "next/navigation";
import { actualizarCodigoBarras, eliminarSku } from "../actions";
import { MovimientosSkuModal } from "./movimientos-sku-modal";

export type Sucursal = {
  id: string;
  nombre: string;
  es_central: boolean;
};

export type SkuRow = {
  id: string;
  nombre: string;
  codigo_interno: string;
  codigo_barras: string | null;
  tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
  volumen: number;
  unidad_volumen: string;
  unidades_contenidas: number;
  stock_minimo: number;
  producto: {
    nombre: string;
    marca: { nombre: string } | null;
    categoria: { nombre: string } | null;
  } | null;
  stockPorSucursal: Record<string, number>;
};

// Reexportadas desde un módulo sin "use client" (ver _lib/presentacion.ts):
// este archivo es cliente, y los server components (dashboards) necesitan
// poder llamar a presentacionLabel() sin cruzar ese límite.
export { presentacionLabel } from "../_lib/presentacion";
export type { SkuPresentacion } from "../_lib/presentacion";

// Mismo criterio que las alertas del dashboard del dueño ("productos sin
// stock" / "bajo mínimo"): acá se reusa por fila para no tener que ir a
// otra pantalla a ver qué SKU necesita atención. Negativo (el POS permite
// vender sin stock, arquitectura.md 1.8) y cero pesan igual de fuerte que
// "sin stock" -- bajo mínimo es una alerta más suave.
function stockClassName(cantidad: number, stockMinimo: number) {
  if (cantidad < 0) return "font-medium text-err";
  if (cantidad === 0) return "text-err";
  if (stockMinimo > 0 && cantidad < stockMinimo) return "font-medium text-warn";
  return "text-text";
}

function totalClassName(total: number) {
  if (total < 0) return "font-medium text-err";
  if (total === 0) return "text-text-3";
  return "text-text";
}

export function ProductosTable({
  sucursales,
  skus,
  puedeCrear,
}: {
  sucursales: Sucursal[];
  skus: SkuRow[];
  puedeCrear: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("");
  // Para la pasada de asignación de códigos con la pistola en el mostrador:
  // deja a la vista qué falta, en vez de tener que acordarse.
  const [soloSinCodigo, setSoloSinCodigo] = useState(false);
  const [skuSeleccionado, setSkuSeleccionado] = useState<SkuRow | null>(null);
  // Asignación de código de barras con la pistola, fila por fila: se abre un
  // input en la celda, se escanea (la lectora escribe el código y manda
  // Enter) y queda vinculado. Es la pasada que se hace en el mostrador
  // después de contar, filtrando por "Sin código de barras".
  const [filaAsignando, setFilaAsignando] = useState<string | null>(null);
  const [codigoInput, setCodigoInput] = useState("");
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [filaOk, setFilaOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [filaEliminando, setFilaEliminando] = useState<string | null>(null);
  const [avisoBaja, setAvisoBaja] = useState<string | null>(null);
  const router = useRouter();

  async function confirmarEliminar(sku: SkuRow) {
    setGuardando(true);
    const resultado = await eliminarSku(sku.id);
    setGuardando(false);
    setFilaEliminando(null);

    if ("error" in resultado) {
      setAvisoBaja(`No se pudo sacar del catálogo: ${resultado.error}`);
      return;
    }
    setAvisoBaja(
      "desactivado" in resultado
        ? `"${sku.producto?.nombre ?? sku.nombre}" tenía movimientos, así que no se borró: quedó dado de baja y ya no aparece en el catálogo ni en el punto de venta.`
        : null,
    );
    router.refresh();
  }

  function abrirAsignacion(skuId: string, codigoActual: string | null) {
    setFilaAsignando(skuId);
    setCodigoInput(codigoActual ?? "");
    setErrorCodigo(null);
  }

  function cerrarAsignacion() {
    setFilaAsignando(null);
    setCodigoInput("");
    setErrorCodigo(null);
  }

  async function guardarCodigo(skuId: string) {
    const codigo = codigoInput.trim();
    if (!codigo) {
      setErrorCodigo("Escaneá o escribí el código.");
      return;
    }
    setGuardando(true);
    const resultado = await actualizarCodigoBarras(skuId, codigo);
    setGuardando(false);
    if ("error" in resultado) {
      setErrorCodigo(resultado.error);
      return;
    }
    cerrarAsignacion();
    setFilaOk(skuId);
    setTimeout(() => setFilaOk((actual) => (actual === skuId ? null : actual)), 2500);
    router.refresh();
  }

  const sinCodigoCount = useMemo(() => skus.filter((s) => !s.codigo_barras).length, [skus]);

  const categorias = useMemo(() => {
    const nombres = new Set<string>();
    for (const sku of skus) {
      if (sku.producto?.categoria?.nombre) nombres.add(sku.producto.categoria.nombre);
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
  }, [skus]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skus.filter((sku) => {
      if (categoria && sku.producto?.categoria?.nombre !== categoria) return false;
      if (soloSinCodigo && sku.codigo_barras) return false;
      if (!q) return true;
      const producto = sku.producto?.nombre.toLowerCase() ?? "";
      const marca = sku.producto?.marca?.nombre.toLowerCase() ?? "";
      const codigo = sku.codigo_interno.toLowerCase();
      return producto.includes(q) || marca.includes(q) || codigo.includes(q);
    });
  }, [skus, query, categoria, soloSinCodigo]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Catálogo</h2>
        <div className="flex flex-wrap items-center gap-3">
          {sinCodigoCount > 0 && (
            <button
              type="button"
              onClick={() => setSoloSinCodigo((v) => !v)}
              className={`whitespace-nowrap rounded-[6px] border px-[10px] py-[5px] text-[13px] ${
                soloSinCodigo
                  ? "border-moe bg-moe-soft font-medium text-moe"
                  : "border-border bg-bg-2 text-text-2 hover:bg-[#EFEFF1]"
              }`}
            >
              Sin código de barras ({sinCodigoCount})
            </button>
          )}
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por producto, marca o código…"
            className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
          <span className="whitespace-nowrap text-[12px] text-text-3">
            {filtrados.length} de {skus.length} SKU
          </span>
          {puedeCrear && (
            <Link
              href="/productos/nuevo"
              className="whitespace-nowrap rounded-[6px] bg-moe px-[11px] py-[6px] text-[12.5px] font-medium text-white hover:bg-moe/90"
            >
              Nuevo producto
            </Link>
          )}
        </div>
      </div>

      {avisoBaja && (
        <p className="border-b border-border bg-warn-bg px-[14px] py-[9px] text-[12.5px] text-warn">
          {avisoBaja}
        </p>
      )}

      {filtrados.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          {skus.length === 0 ? (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                Todavía no hay productos cargados
              </p>
              <p className="text-[12.5px] text-text-3">
                El catálogo aparece acá una vez que se den de alta marcas, productos y SKU.
              </p>
            </>
          ) : (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                No encontramos productos
              </p>
              <p className="text-[12.5px] text-text-3">Probá con otro nombre, marca o código.</p>
            </>
          )}
        </div>
      ) : (
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Producto
                </th>
                <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Presentación
                </th>
                <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Código de barras
                </th>
                {sucursales.map((s) => (
                  <th
                    key={s.id}
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2"
                  >
                    Stock {s.nombre}
                  </th>
                ))}
                <th className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  Total
                </th>
                {puedeCrear && (
                  <th className="sticky top-0 z-10 w-[90px] border-b border-border bg-bg-2 px-[14px] py-[7px]" />
                )}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((sku) => {
                const cantidades = sucursales.map((s) => sku.stockPorSucursal[s.id] ?? 0);
                const total = cantidades.reduce((acc, c) => acc + c, 0);

                return (
                  <tr
                    key={sku.id}
                    onClick={() => setSkuSeleccionado(sku)}
                    className="cursor-pointer border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]"
                    title="Ver historial de movimientos"
                  >
                    <td className="px-[14px] py-[9px] align-middle">
                      <p className="font-medium text-text">{sku.producto?.nombre ?? sku.nombre}</p>
                      <p className="text-[11.5px] text-text-3">
                        {[sku.producto?.marca?.nombre, sku.producto?.categoria?.nombre]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                    <td className="px-[14px] py-[9px] align-middle text-text-2">
                      {presentacionLabel(sku)}
                    </td>
                    {/* La fila entera abre el historial de movimientos: todo
                        lo de esta celda frena la propagación para que
                        escanear no dispare el modal. */}
                    <td
                      className="px-[14px] py-[9px] align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {filaAsignando === sku.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={codigoInput}
                            disabled={guardando}
                            onChange={(e) => setCodigoInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                guardarCodigo(sku.id);
                              }
                              if (e.key === "Escape") cerrarAsignacion();
                            }}
                            placeholder="Escaneá el código…"
                            className="w-[170px] rounded-[6px] border border-moe bg-bg px-[8px] py-[4px] text-[12.5px] tabular-nums outline-none"
                          />
                          <button
                            type="button"
                            onClick={cerrarAsignacion}
                            className="text-[11.5px] text-text-3 hover:text-err"
                          >
                            Cancelar
                          </button>
                          {errorCodigo && (
                            <span className="text-[11.5px] text-err">{errorCodigo}</span>
                          )}
                        </div>
                      ) : filaOk === sku.id ? (
                        <span className="text-[12.5px] text-ok">Código asignado ✓</span>
                      ) : sku.codigo_barras ? (
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums text-text-2">{sku.codigo_barras}</span>
                          {puedeCrear && (
                            <button
                              type="button"
                              onClick={() => abrirAsignacion(sku.id, sku.codigo_barras)}
                              className="text-[11.5px] text-text-3 underline underline-offset-2 hover:text-moe"
                            >
                              cambiar
                            </button>
                          )}
                        </span>
                      ) : puedeCrear ? (
                        <button
                          type="button"
                          onClick={() => abrirAsignacion(sku.id, null)}
                          className="rounded-[5px] border border-warn/40 bg-warn-bg px-[8px] py-[3px] text-[11.5px] font-medium text-warn"
                        >
                          Asignar
                        </button>
                      ) : (
                        <span className="text-[12.5px] text-text-3">—</span>
                      )}
                    </td>
                    {cantidades.map((cantidad, i) => (
                      <td
                        key={sucursales[i].id}
                        className={`px-[14px] py-[9px] text-right tabular-nums ${stockClassName(cantidad, sku.stock_minimo)}`}
                      >
                        {cantidad}
                      </td>
                    ))}
                    <td
                      className={`px-[14px] py-[9px] text-right font-medium tabular-nums ${totalClassName(total)}`}
                    >
                      {total}
                    </td>
                    {puedeCrear && (
                      <td
                        className="px-[14px] py-[9px] text-right align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {filaEliminando === sku.id ? (
                          <span className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={guardando}
                              onClick={() => confirmarEliminar(sku)}
                              className="text-[12px] font-medium text-err hover:underline disabled:opacity-60"
                            >
                              Sí, sacar
                            </button>
                            <button
                              type="button"
                              onClick={() => setFilaEliminando(null)}
                              className="text-[12px] text-text-3 hover:text-text"
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            title="Sacar del catálogo"
                            onClick={() => {
                              setAvisoBaja(null);
                              setFilaEliminando(sku.id);
                            }}
                            className="text-[15px] leading-none text-text-3 hover:text-err"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {skuSeleccionado && (
        <MovimientosSkuModal
          skuId={skuSeleccionado.id}
          nombre={skuSeleccionado.producto?.nombre ?? skuSeleccionado.nombre}
          presentacion={presentacionLabel(skuSeleccionado)}
          onClose={() => setSkuSeleccionado(null)}
        />
      )}
    </div>
  );
}
