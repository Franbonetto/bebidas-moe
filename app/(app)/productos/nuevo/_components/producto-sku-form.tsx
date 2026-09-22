"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearProductoYSku, type NuevoProductoInput } from "../../actions";

export type MarcaOpcion = { id: string; nombre: string };
export type CategoriaOpcion = { id: string; nombre: string; categoria_padre_id: string | null };
export type ProductoOpcion = { id: string; nombre: string; marca: { nombre: string } | null };
export type TipoEnvaseOpcion = { id: string; nombre: string; es_generico: boolean; valor_deposito: number };
export type ProveedorOpcion = { id: string; razon_social: string; nombre_comercial: string | null };
export type SkuOpcion = {
  id: string;
  nombre: string;
  codigo_interno: string;
  tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
  volumen: number;
  unidad_volumen: string;
  unidades_contenidas: number;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";
const seccionClass = "rounded-card border border-border bg-bg p-4";
const modoBtnClass = (activo: boolean) =>
  `rounded-[6px] border px-[10px] py-[5px] text-[12.5px] font-medium ${
    activo ? "border-moe bg-moe-soft text-moe" : "border-border bg-bg text-text-2 hover:bg-bg-2"
  }`;

function skuLabel(s: { nombre: string; producto: { nombre: string; marca: { nombre: string } | null } | null }) {
  const producto = s.producto?.nombre ?? s.nombre;
  const marca = s.producto?.marca?.nombre;
  return marca ? `${producto} — ${marca} (${s.nombre})` : `${producto} (${s.nombre})`;
}

function proveedorLabel(p: ProveedorOpcion) {
  return p.nombre_comercial ?? p.razon_social;
}

export function ProductoSkuForm({
  marcas,
  categorias,
  productos,
  tiposEnvase,
  skus,
  proveedores,
}: {
  marcas: MarcaOpcion[];
  categorias: CategoriaOpcion[];
  productos: ProductoOpcion[];
  tiposEnvase: TipoEnvaseOpcion[];
  skus: SkuOpcion[];
  proveedores: ProveedorOpcion[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ---- Producto ----
  const [productoModo, setProductoModo] = useState<"existente" | "nuevo">("nuevo");
  const [productoId, setProductoId] = useState("");
  const [productoQuery, setProductoQuery] = useState("");
  const [productoNombreNuevo, setProductoNombreNuevo] = useState("");

  const productosFiltrados = useMemo(() => {
    const q = productoQuery.trim().toLowerCase();
    if (!q) return [];
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(q) || (p.marca?.nombre ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [productos, productoQuery]);

  const productoSeleccionado = productos.find((p) => p.id === productoId) ?? null;

  // ---- Marca / categoría (solo para producto nuevo) ----
  const [marcaModo, setMarcaModo] = useState<"existente" | "nueva">(marcas.length > 0 ? "existente" : "nueva");
  const [marcaId, setMarcaId] = useState("");
  const [marcaNombreNueva, setMarcaNombreNueva] = useState("");

  const [categoriaModo, setCategoriaModo] = useState<"existente" | "nueva">(
    categorias.length > 0 ? "existente" : "nueva",
  );
  const [categoriaId, setCategoriaId] = useState("");
  const [categoriaNombreNueva, setCategoriaNombreNueva] = useState("");
  const [categoriaPadreId, setCategoriaPadreId] = useState("");

  // ---- SKU ----
  const [nombreSku, setNombreSku] = useState("");
  const [codigoInterno, setCodigoInterno] = useState("");
  const [codigoBarras, setCodigoBarras] = useState("");
  const nombreSkuRef = useRef<HTMLInputElement>(null);
  const [volumen, setVolumen] = useState("");
  const [unidadVolumen, setUnidadVolumen] = useState<"ml" | "l" | "un" | "g">("ml");
  const [tipoPresentacion, setTipoPresentacion] = useState<"unidad" | "pack" | "cajon" | "estuche">("unidad");
  const [unidadesContenidas, setUnidadesContenidas] = useState("1");
  const [stockMinimo, setStockMinimo] = useState("0");
  const [stockObjetivo, setStockObjetivo] = useState("0");

  // ---- Retornable ----
  const [esRetornable, setEsRetornable] = useState(false);
  const [tipoEnvaseModo, setTipoEnvaseModo] = useState<"existente" | "nueva">(
    tiposEnvase.length > 0 ? "existente" : "nueva",
  );
  const [tipoEnvaseId, setTipoEnvaseId] = useState("");
  const [tipoEnvaseNombreNueva, setTipoEnvaseNombreNueva] = useState("");
  const [tipoEnvaseEsGenerico, setTipoEnvaseEsGenerico] = useState(false);
  const [tipoEnvaseValorDeposito, setTipoEnvaseValorDeposito] = useState("0");

  // ---- Desarme ----
  const [seDesarma, setSeDesarma] = useState(false);
  const [desarmaEnSkuId, setDesarmaEnSkuId] = useState("");
  const [desarmaQuery, setDesarmaQuery] = useState("");
  const [desarmaEnCantidad, setDesarmaEnCantidad] = useState("");

  const desarmaSkuResultados = useMemo(() => {
    const q = desarmaQuery.trim().toLowerCase();
    if (!q) return [];
    return skus.filter((s) => skuLabel(s).toLowerCase().includes(q)).slice(0, 8);
  }, [skus, desarmaQuery]);

  const desarmaSkuSeleccionado = skus.find((s) => s.id === desarmaEnSkuId) ?? null;

  // ---- Proveedores (proveedor_skus: opcional, uno o varios por SKU) ----
  const [proveedorFilas, setProveedorFilas] = useState<{ proveedorId: string; costoReferencia: string }[]>([]);

  function agregarProveedorFila() {
    setProveedorFilas((prev) => [...prev, { proveedorId: "", costoReferencia: "" }]);
  }

  function actualizarProveedorFila(index: number, campo: "proveedorId" | "costoReferencia", valor: string) {
    setProveedorFilas((prev) => prev.map((f, i) => (i === index ? { ...f, [campo]: valor } : f)));
  }

  function quitarProveedorFila(index: number) {
    setProveedorFilas((prev) => prev.filter((_, i) => i !== index));
  }

  function validar(): string | null {
    if (productoModo === "existente" && !productoId) return "Elegí un producto existente.";
    if (productoModo === "nuevo") {
      if (!productoNombreNuevo.trim()) return "Ingresá el nombre del producto.";
      if (marcaModo === "existente" && !marcaId) return "Elegí una marca.";
      if (marcaModo === "nueva" && !marcaNombreNueva.trim()) return "Ingresá el nombre de la marca nueva.";
      if (categoriaModo === "existente" && !categoriaId) return "Elegí una categoría.";
      if (categoriaModo === "nueva" && !categoriaNombreNueva.trim())
        return "Ingresá el nombre de la categoría nueva.";
    }

    if (!nombreSku.trim()) return "Ingresá el nombre del SKU.";
    if (!codigoInterno.trim()) return "Ingresá el código interno.";
    const volumenNum = Number(volumen);
    if (!volumen || Number.isNaN(volumenNum) || volumenNum <= 0) return "El volumen tiene que ser mayor a cero.";
    const unidadesNum = Number(unidadesContenidas);
    if (!Number.isInteger(unidadesNum) || unidadesNum <= 0)
      return "Unidades contenidas tiene que ser un entero mayor a cero.";
    const stockMinNum = Number(stockMinimo);
    const stockObjNum = Number(stockObjetivo);
    if (!Number.isInteger(stockMinNum) || stockMinNum < 0) return "El stock mínimo no puede ser negativo.";
    if (!Number.isInteger(stockObjNum) || stockObjNum < 0) return "El stock objetivo no puede ser negativo.";

    if (esRetornable) {
      if (tipoEnvaseModo === "existente" && !tipoEnvaseId) return "Elegí un tipo de envase.";
      if (tipoEnvaseModo === "nueva") {
        if (!tipoEnvaseNombreNueva.trim()) return "Ingresá el nombre del tipo de envase nuevo.";
        const deposito = Number(tipoEnvaseValorDeposito);
        if (Number.isNaN(deposito) || deposito < 0) return "El valor de depósito no puede ser negativo.";
      }
    }

    if (seDesarma) {
      if (!desarmaEnSkuId) return "Elegí en qué SKU se desarma.";
      const cantidad = Number(desarmaEnCantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0)
        return "La cantidad de desarme tiene que ser un entero mayor a cero.";
    }

    const proveedorIdsUsados = new Set<string>();
    for (const fila of proveedorFilas) {
      if (!fila.proveedorId) return "Elegí un proveedor en cada fila, o quitá la fila vacía.";
      if (proveedorIdsUsados.has(fila.proveedorId)) return "Hay un proveedor repetido en la lista.";
      proveedorIdsUsados.add(fila.proveedorId);
      if (fila.costoReferencia.trim()) {
        const costo = Number(fila.costoReferencia);
        if (Number.isNaN(costo) || costo < 0) return "El costo de referencia no puede ser negativo.";
      }
    }

    return null;
  }

  function guardar() {
    const errorValidacion = validar();
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }
    setError(null);

    const input: NuevoProductoInput = {
      producto:
        productoModo === "existente" ? { id: productoId } : { nombreNuevo: productoNombreNuevo.trim() },
      marca: marcaModo === "existente" ? { id: marcaId } : { nombreNueva: marcaNombreNueva.trim() },
      categoria:
        categoriaModo === "existente"
          ? { id: categoriaId }
          : { nombreNueva: categoriaNombreNueva.trim(), categoriaPadreId: categoriaPadreId || null },
      sku: {
        nombre: nombreSku.trim(),
        codigoInterno: codigoInterno.trim(),
        codigoBarras: codigoBarras.trim() || null,
        volumen: Number(volumen),
        unidadVolumen,
        tipoPresentacion,
        unidadesContenidas: Number(unidadesContenidas),
        esRetornable,
        tipoEnvase: !esRetornable
          ? null
          : tipoEnvaseModo === "existente"
            ? { id: tipoEnvaseId }
            : {
                nombreNueva: tipoEnvaseNombreNueva.trim(),
                esGenerico: tipoEnvaseEsGenerico,
                valorDeposito: Number(tipoEnvaseValorDeposito),
              },
        desarmaEnSkuId: seDesarma ? desarmaEnSkuId : null,
        desarmaEnCantidad: seDesarma ? Number(desarmaEnCantidad) : null,
        stockMinimo: Number(stockMinimo),
        stockObjetivo: Number(stockObjetivo),
      },
      proveedores: proveedorFilas.map((f) => ({
        proveedorId: f.proveedorId,
        costoReferencia: f.costoReferencia.trim() ? Number(f.costoReferencia) : null,
      })),
    };

    startTransition(async () => {
      const resultado = await crearProductoYSku(input);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push("/productos");
    });
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-text">Nuevo producto</h1>
        <button
          type="button"
          onClick={() => router.push("/productos")}
          className="text-[12.5px] text-text-2 hover:text-text"
        >
          ← Volver al catálogo
        </button>
      </div>

      {/* ============ Producto ============ */}
      <div className={seccionClass}>
        <h2 className="mb-3 text-[13px] font-semibold text-text">Producto</h2>
        <div className="mb-3 flex gap-2">
          <button type="button" className={modoBtnClass(productoModo === "nuevo")} onClick={() => setProductoModo("nuevo")}>
            Producto nuevo
          </button>
          <button
            type="button"
            className={modoBtnClass(productoModo === "existente")}
            onClick={() => setProductoModo("existente")}
          >
            Presentación nueva de un producto existente
          </button>
        </div>

        {productoModo === "existente" ? (
          <div>
            <label className={labelClass}>Buscar producto *</label>
            {productoSeleccionado ? (
              <div className="flex items-center justify-between rounded-[6px] border border-border bg-bg-2 px-[10px] py-[7px] text-[13px]">
                <span>
                  <span className="font-medium text-text">{productoSeleccionado.nombre}</span>
                  {productoSeleccionado.marca && (
                    <span className="text-text-3"> · {productoSeleccionado.marca.nombre}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setProductoId("")}
                  className="text-[12px] text-text-3 hover:text-err"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={productoQuery}
                  onChange={(e) => setProductoQuery(e.target.value)}
                  placeholder="Nombre del producto o marca…"
                  className={inputClass}
                />
                {productosFiltrados.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-bg shadow-sm">
                    {productosFiltrados.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setProductoId(p.id);
                          setProductoQuery("");
                        }}
                        className="block w-full border-b border-[#F1F1F3] px-[10px] py-[7px] text-left text-[13px] last:border-b-0 hover:bg-bg-2"
                      >
                        <span className="font-medium text-text">{p.nombre}</span>
                        {p.marca && <span className="text-text-3"> · {p.marca.nombre}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Nombre del producto *</label>
              <input
                type="text"
                value={productoNombreNuevo}
                onChange={(e) => setProductoNombreNuevo(e.target.value)}
                placeholder="Ej. Fernet Branca"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Marca *</label>
              <div className="mb-2 flex gap-2">
                <button type="button" className={modoBtnClass(marcaModo === "existente")} onClick={() => setMarcaModo("existente")}>
                  Existente
                </button>
                <button type="button" className={modoBtnClass(marcaModo === "nueva")} onClick={() => setMarcaModo("nueva")}>
                  + Nueva marca
                </button>
              </div>
              {marcaModo === "existente" ? (
                <select className={inputClass} value={marcaId} onChange={(e) => setMarcaId(e.target.value)}>
                  <option value="">Elegir…</option>
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={marcaNombreNueva}
                  onChange={(e) => setMarcaNombreNueva(e.target.value)}
                  placeholder="Nombre de la marca nueva"
                  className={inputClass}
                />
              )}
            </div>

            <div>
              <label className={labelClass}>Categoría *</label>
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  className={modoBtnClass(categoriaModo === "existente")}
                  onClick={() => setCategoriaModo("existente")}
                >
                  Existente
                </button>
                <button type="button" className={modoBtnClass(categoriaModo === "nueva")} onClick={() => setCategoriaModo("nueva")}>
                  + Nueva categoría
                </button>
              </div>
              {categoriaModo === "existente" ? (
                <select className={inputClass} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                  <option value="">Elegir…</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={categoriaNombreNueva}
                    onChange={(e) => setCategoriaNombreNueva(e.target.value)}
                    placeholder="Nombre de la categoría nueva"
                    className={inputClass}
                  />
                  <select
                    className={inputClass}
                    value={categoriaPadreId}
                    onChange={(e) => setCategoriaPadreId(e.target.value)}
                  >
                    <option value="">Sin categoría padre</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============ SKU ============ */}
      <div className={seccionClass}>
        <h2 className="mb-3 text-[13px] font-semibold text-text">Datos del SKU</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Nombre *</label>
            <input
              ref={nombreSkuRef}
              type="text"
              value={nombreSku}
              onChange={(e) => setNombreSku(e.target.value)}
              placeholder="Ej. Fernet Branca 750cc"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Código interno *</label>
            <input
              type="text"
              value={codigoInterno}
              onChange={(e) => setCodigoInterno(e.target.value)}
              placeholder="Ej. BRANCA-750"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Código de barras</label>
            <input
              type="text"
              autoFocus
              value={codigoBarras}
              onChange={(e) => setCodigoBarras(e.target.value)}
              // Pistola lectora: escanea, "escribe" el código y manda un Enter
              // solo — no hay <form> acá (se guarda con un botón), así que el
              // Enter no dispara nada por sí solo. Esto lo aprovecha para
              // saltar directo a Nombre y no perder tiempo pasando de campo
              // en campo a mano.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  nombreSkuRef.current?.focus();
                }
              }}
              placeholder="Escaneá con la pistola o cargalo a mano — opcional"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label className={labelClass}>Volumen *</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={volumen}
                onChange={(e) => setVolumen(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Unidad</label>
              <select
                className={inputClass}
                value={unidadVolumen}
                onChange={(e) => setUnidadVolumen(e.target.value as "ml" | "l" | "un" | "g")}
              >
                <option value="ml">ml</option>
                <option value="l">l</option>
                <option value="un">unidad</option>
                <option value="g">gramo</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Tipo de presentación</label>
            <select
              className={inputClass}
              value={tipoPresentacion}
              onChange={(e) =>
                setTipoPresentacion(e.target.value as "unidad" | "pack" | "cajon" | "estuche")
              }
            >
              <option value="unidad">Unidad</option>
              <option value="pack">Pack</option>
              <option value="cajon">Cajón</option>
              <option value="estuche">Estuche</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Unidades contenidas *</label>
            <input
              type="number"
              min={1}
              value={unidadesContenidas}
              onChange={(e) => setUnidadesContenidas(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Stock mínimo</label>
            <input
              type="number"
              min={0}
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Stock objetivo</label>
            <input
              type="number"
              min={0}
              value={stockObjetivo}
              onChange={(e) => setStockObjetivo(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* ============ Retornable ============ */}
      <div className={seccionClass}>
        <label className="flex items-center gap-2 text-[13px] font-medium text-text">
          <input type="checkbox" checked={esRetornable} onChange={(e) => setEsRetornable(e.target.checked)} />
          Es retornable
        </label>

        {esRetornable && (
          <div className="mt-3">
            <label className={labelClass}>Tipo de envase *</label>
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                className={modoBtnClass(tipoEnvaseModo === "existente")}
                onClick={() => setTipoEnvaseModo("existente")}
              >
                Existente
              </button>
              <button
                type="button"
                className={modoBtnClass(tipoEnvaseModo === "nueva")}
                onClick={() => setTipoEnvaseModo("nueva")}
              >
                + Nuevo tipo de envase
              </button>
            </div>
            {tipoEnvaseModo === "existente" ? (
              <select className={inputClass} value={tipoEnvaseId} onChange={(e) => setTipoEnvaseId(e.target.value)}>
                <option value="">Elegir…</option>
                {tiposEnvase.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} {t.es_generico ? "(genérico)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <input
                  type="text"
                  value={tipoEnvaseNombreNueva}
                  onChange={(e) => setTipoEnvaseNombreNueva(e.target.value)}
                  placeholder="Nombre del tipo de envase"
                  className={inputClass}
                />
                <input
                  type="number"
                  min={0}
                  value={tipoEnvaseValorDeposito}
                  onChange={(e) => setTipoEnvaseValorDeposito(e.target.value)}
                  placeholder="Depósito $"
                  className={`${inputClass} w-[120px]`}
                />
                <label className="flex items-center gap-1 whitespace-nowrap px-[6px] text-[12.5px] text-text-2">
                  <input
                    type="checkbox"
                    checked={tipoEnvaseEsGenerico}
                    onChange={(e) => setTipoEnvaseEsGenerico(e.target.checked)}
                  />
                  Genérico
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============ Desarme ============ */}
      <div className={seccionClass}>
        <label className="flex items-center gap-2 text-[13px] font-medium text-text">
          <input type="checkbox" checked={seDesarma} onChange={(e) => setSeDesarma(e.target.checked)} />
          Es un pack que se desarma (ej. x24 → x6, x6 → unidad)
        </label>

        {seDesarma && (
          <div className="mt-3 grid grid-cols-[1fr_140px] gap-2">
            <div>
              <label className={labelClass}>Se desarma en *</label>
              {desarmaSkuSeleccionado ? (
                <div className="flex items-center justify-between rounded-[6px] border border-border bg-bg-2 px-[10px] py-[7px] text-[13px]">
                  <span className="text-text">{skuLabel(desarmaSkuSeleccionado)}</span>
                  <button
                    type="button"
                    onClick={() => setDesarmaEnSkuId("")}
                    className="text-[12px] text-text-3 hover:text-err"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={desarmaQuery}
                    onChange={(e) => setDesarmaQuery(e.target.value)}
                    placeholder="Buscar el SKU destino (ej. la unidad o el pack x6)…"
                    className={inputClass}
                  />
                  {desarmaSkuResultados.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-bg shadow-sm">
                      {desarmaSkuResultados.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setDesarmaEnSkuId(s.id);
                            setDesarmaQuery("");
                          }}
                          className="block w-full border-b border-[#F1F1F3] px-[10px] py-[7px] text-left text-[13px] last:border-b-0 hover:bg-bg-2"
                        >
                          {skuLabel(s)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className={labelClass}>Factor (cuántos produce) *</label>
              <input
                type="number"
                min={1}
                value={desarmaEnCantidad}
                onChange={(e) => setDesarmaEnCantidad(e.target.value)}
                placeholder="Ej. 6"
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>

      {/* ============ Proveedores ============ */}
      <div className={seccionClass}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-text">Proveedores</h2>
          <button type="button" onClick={agregarProveedorFila} className={modoBtnClass(false)}>
            + Agregar proveedor
          </button>
        </div>

        {proveedorFilas.length === 0 ? (
          <p className="text-[12.5px] text-text-3">
            Opcional — se puede dejar sin proveedor (ej. combos o envases genéricos) y cargarlo después.
          </p>
        ) : (
          <div className="space-y-2">
            {proveedorFilas.map((fila, index) => (
              <div key={index} className="grid grid-cols-[1fr_140px_auto] gap-2">
                <select
                  className={inputClass}
                  value={fila.proveedorId}
                  onChange={(e) => actualizarProveedorFila(index, "proveedorId", e.target.value)}
                >
                  <option value="">Elegir proveedor…</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {proveedorLabel(p)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={fila.costoReferencia}
                  onChange={(e) => actualizarProveedorFila(index, "costoReferencia", e.target.value)}
                  placeholder="Costo ref. (opcional)"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => quitarProveedorFila(index)}
                  className="rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[12.5px] text-text-3 hover:bg-bg-2 hover:text-err"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-[12.5px] text-err">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/productos")}
          disabled={pending}
          className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar producto"}
        </button>
      </div>
    </div>
  );
}
