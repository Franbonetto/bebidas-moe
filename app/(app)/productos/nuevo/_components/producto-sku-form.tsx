"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearProductoYSku, editarSkuCompleto, type NuevoProductoInput } from "../../actions";

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

type DerivadoForm = {
  nombre: string;
  codigoBarras: string;
  tipoPresentacion: "unidad" | "pack" | "cajon" | "estuche";
  unidadesContenidas: string;
  factor: string;
};

// Los valores que vienen puestos son los de la cascada de cerveza, que es
// el caso para el que se hizo esto: un x24 se desarma en 4 packs x6, y cada
// x6 en 6 unidades. Se pueden pisar.
function derivadoPorNivel(nivel: number, nombreProducto: string): DerivadoForm {
  return nivel === 0
    ? {
        nombre: nombreProducto ? `${nombreProducto} pack x6` : "",
        codigoBarras: "",
        tipoPresentacion: "pack",
        unidadesContenidas: "6",
        factor: "4",
      }
    : {
        nombre: nombreProducto ? `${nombreProducto} unidad` : "",
        codigoBarras: "",
        tipoPresentacion: "unidad",
        unidadesContenidas: "1",
        factor: "6",
      };
}

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

// Mismo criterio que siguienteCodigoInterno() en el servidor, con la lista
// que la pantalla ya tiene cargada: solo cuentan los códigos numéricos.
function siguienteCodigoLibre(skus: SkuOpcion[]): string {
  const maximo = skus.reduce((acc, sku) => {
    const codigo = (sku.codigo_interno ?? "").trim();
    if (!/^\d+$/.test(codigo)) return acc;
    return Math.max(acc, Number(codigo));
  }, 0);
  return String(maximo + 1).padStart(5, "0");
}

// Mismo formulario, dos usos: alta (sin skuEditar) y edición (con). En
// edición viene todo cargado y se guarda con editarSkuCompleto() -- pedido
// del usuario 2026-10-08, el cuadrito de nombre y presentación se quedaba
// corto.
export type SkuParaEditar = {
  id: string;
  nombre: string;
  codigoInterno: string;
  codigoBarras: string;
  volumen: string;
  unidadVolumen: "ml" | "l" | "un" | "g";
  tipoPresentacion: "unidad" | "pack" | "cajon" | "estuche";
  unidadesContenidas: string;
  stockMinimo: string;
  stockObjetivo: string;
  esRetornable: boolean;
  tipoEnvaseId: string;
  desarmaEnSkuId: string;
  desarmaEnCantidad: string;
  productoNombre: string;
  marcaId: string;
  categoriaId: string;
  // Cuántas otras presentaciones cuelgan del mismo producto. Si hay, tocar
  // el nombre/marca/categoría separa esta en un producto propio en vez de
  // cambiárselo a todas.
  hermanas: number;
  proveedores: { proveedorId: string; costoReferencia: string }[];
};

export function ProductoSkuForm({
  marcas,
  categorias,
  productos,
  tiposEnvase,
  skus,
  proveedores,
  skuEditar,
}: {
  marcas: MarcaOpcion[];
  categorias: CategoriaOpcion[];
  productos: ProductoOpcion[];
  tiposEnvase: TipoEnvaseOpcion[];
  skus: SkuOpcion[];
  proveedores: ProveedorOpcion[];
  skuEditar?: SkuParaEditar;
}) {
  const editando = skuEditar != null;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ---- Producto ----
  const [productoModo, setProductoModo] = useState<"existente" | "nuevo">("nuevo");
  // Editando nunca se usa el buscador de "producto existente": los campos de
  // nombre, marca y categoría se editan directo, que es la rama "nuevo".
  const [productoId, setProductoId] = useState("");
  const [productoQuery, setProductoQuery] = useState("");
  const [productoNombreNuevo, setProductoNombreNuevo] = useState(skuEditar?.productoNombre ?? "");

  const productosFiltrados = useMemo(() => {
    const q = productoQuery.trim().toLowerCase();
    if (!q) return [];
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(q) || (p.marca?.nombre ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [productos, productoQuery]);

  const productoSeleccionado = productos.find((p) => p.id === productoId) ?? null;
  const nombreProductoActual =
    productoModo === "existente"
      ? (productoSeleccionado?.nombre ?? "")
      : productoNombreNuevo.trim();

  // ---- Marca / categoría (solo para producto nuevo) ----
  const [marcaModo, setMarcaModo] = useState<"existente" | "nueva">(marcas.length > 0 ? "existente" : "nueva");
  const [marcaId, setMarcaId] = useState(skuEditar?.marcaId ?? "");
  const [marcaNombreNueva, setMarcaNombreNueva] = useState("");

  const [categoriaModo, setCategoriaModo] = useState<"existente" | "nueva">(
    categorias.length > 0 ? "existente" : "nueva",
  );
  const [categoriaId, setCategoriaId] = useState(skuEditar?.categoriaId ?? "");
  const [categoriaNombreNueva, setCategoriaNombreNueva] = useState("");
  const [categoriaPadreId, setCategoriaPadreId] = useState("");

  // ---- SKU ----
  const [nombreSku, setNombreSku] = useState(skuEditar?.nombre ?? "");
  // Arranca con el siguiente número libre: es un identificador interno que
  // nadie memoriza y tipearlo a mano solo servía para chocar con uno ya
  // usado (pasó cargando el catálogo, 2026-09-29). Se puede pisar a mano si
  // se quiere un código hablado tipo BRANCA-750.
  const [codigoInterno, setCodigoInterno] = useState(
    () => skuEditar?.codigoInterno ?? siguienteCodigoLibre(skus),
  );
  const [codigoBarras, setCodigoBarras] = useState(skuEditar?.codigoBarras ?? "");
  const nombreSkuRef = useRef<HTMLInputElement>(null);
  const [volumen, setVolumen] = useState(skuEditar?.volumen ?? "");
  const [unidadVolumen, setUnidadVolumen] = useState<"ml" | "l" | "un" | "g">(
    skuEditar?.unidadVolumen ?? "ml",
  );
  const [tipoPresentacion, setTipoPresentacion] = useState<"unidad" | "pack" | "cajon" | "estuche">(
    skuEditar?.tipoPresentacion ?? "unidad",
  );
  const [unidadesContenidas, setUnidadesContenidas] = useState(skuEditar?.unidadesContenidas ?? "1");
  const [stockMinimo, setStockMinimo] = useState(skuEditar?.stockMinimo ?? "0");
  const [stockObjetivo, setStockObjetivo] = useState(skuEditar?.stockObjetivo ?? "0");

  // ---- Retornable ----
  const [esRetornable, setEsRetornable] = useState(skuEditar?.esRetornable ?? false);
  const [tipoEnvaseModo, setTipoEnvaseModo] = useState<"existente" | "nueva">(
    tiposEnvase.length > 0 ? "existente" : "nueva",
  );
  const [tipoEnvaseId, setTipoEnvaseId] = useState(skuEditar?.tipoEnvaseId ?? "");
  const [tipoEnvaseNombreNueva, setTipoEnvaseNombreNueva] = useState("");
  const [tipoEnvaseEsGenerico, setTipoEnvaseEsGenerico] = useState(false);
  const [tipoEnvaseValorDeposito, setTipoEnvaseValorDeposito] = useState("0");

  // ---- Desarme ----
  const [seDesarma, setSeDesarma] = useState(Boolean(skuEditar?.desarmaEnSkuId));
  // "existente" = apuntar a un SKU ya cargado (lo de siempre).
  // "nueva" = crear las presentaciones acá mismo, en cascada. Pedido del
  // usuario 2026-10-06: cargar una cerveza era dar de alta tres veces y en
  // orden inverso (unidad, después x6, después x24) porque el desarme solo
  // aceptaba un SKU que ya existiera.
  // Editando solo se puede apuntar a una presentación que ya exista: crear
  // la cascada entera es una operación del alta.
  const [desarmaModo, setDesarmaModo] = useState<"existente" | "nueva">(
    skuEditar ? "existente" : "nueva",
  );
  const [desarmaEnSkuId, setDesarmaEnSkuId] = useState(skuEditar?.desarmaEnSkuId ?? "");
  const [desarmaQuery, setDesarmaQuery] = useState("");
  const [desarmaEnCantidad, setDesarmaEnCantidad] = useState(skuEditar?.desarmaEnCantidad ?? "");
  // De afuera hacia adentro: [pack x6, unidad]. Dos niveles alcanzan para
  // la cascada documentada (x24 -> 4x x6 -> 6x unidad).
  const [derivados, setDerivados] = useState<DerivadoForm[]>([]);

  const desarmaSkuResultados = useMemo(() => {
    const q = desarmaQuery.trim().toLowerCase();
    if (!q) return [];
    return skus.filter((s) => skuLabel(s).toLowerCase().includes(q)).slice(0, 8);
  }, [skus, desarmaQuery]);

  const desarmaSkuSeleccionado = skus.find((s) => s.id === desarmaEnSkuId) ?? null;

  // ---- Proveedores (proveedor_skus: opcional, uno o varios por SKU) ----
  const [proveedorFilas, setProveedorFilas] = useState<{ proveedorId: string; costoReferencia: string }[]>(
    skuEditar?.proveedores ?? [],
  );

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
      if (desarmaModo === "existente") {
        if (!desarmaEnSkuId) return "Elegí en qué SKU se desarma.";
        const cantidad = Number(desarmaEnCantidad);
        if (!Number.isInteger(cantidad) || cantidad <= 0)
          return "La cantidad de desarme tiene que ser un entero mayor a cero.";
      } else {
        if (derivados.length === 0)
          return "Agregá la presentación en la que se desarma, o elegí una que ya exista.";
        for (const d of derivados) {
          if (!d.nombre.trim()) return "Cada presentación del desarme necesita un nombre.";
          const factor = Number(d.factor);
          if (!Number.isInteger(factor) || factor <= 0)
            return `"${d.nombre.trim()}": cuántas produce el desarme tiene que ser un entero mayor a cero.`;
          const unidades = Number(d.unidadesContenidas);
          if (!Number.isInteger(unidades) || unidades <= 0)
            return `"${d.nombre.trim()}": las unidades contenidas tienen que ser un entero mayor a cero.`;
        }
        const codigos = derivados.map((d) => d.codigoBarras.trim()).filter(Boolean);
        if (new Set(codigos).size !== codigos.length)
          return "Hay dos presentaciones del desarme con el mismo código de barras.";
        if (codigoBarras.trim() && codigos.includes(codigoBarras.trim()))
          return "Una presentación del desarme tiene el mismo código de barras que el pack principal.";
      }
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
        desarmaEnSkuId: seDesarma && desarmaModo === "existente" ? desarmaEnSkuId : null,
        desarmaEnCantidad:
          seDesarma && desarmaModo === "existente" ? Number(desarmaEnCantidad) : null,
        desarmaCadena:
          seDesarma && desarmaModo === "nueva"
            ? derivados.map((d) => ({
                nombre: d.nombre.trim(),
                codigoBarras: d.codigoBarras.trim() || null,
                tipoPresentacion: d.tipoPresentacion,
                unidadesContenidas: Number(d.unidadesContenidas),
                factor: Number(d.factor),
              }))
            : [],
        stockMinimo: Number(stockMinimo),
        stockObjetivo: Number(stockObjetivo),
      },
      proveedores: proveedorFilas.map((f) => ({
        proveedorId: f.proveedorId,
        costoReferencia: f.costoReferencia.trim() ? Number(f.costoReferencia) : null,
      })),
    };

    startTransition(async () => {
      const resultado = skuEditar
        ? await editarSkuCompleto(skuEditar.id, {
            producto: {
              nombre: productoNombreNuevo.trim(),
              marca: input.marca,
              categoria: input.categoria,
            },
            sku: {
              nombre: input.sku.nombre,
              codigoInterno: input.sku.codigoInterno,
              codigoBarras: input.sku.codigoBarras,
              volumen: input.sku.volumen,
              unidadVolumen: input.sku.unidadVolumen,
              tipoPresentacion: input.sku.tipoPresentacion,
              unidadesContenidas: input.sku.unidadesContenidas,
              esRetornable: input.sku.esRetornable,
              tipoEnvase: input.sku.tipoEnvase,
              desarmaEnSkuId: input.sku.desarmaEnSkuId,
              desarmaEnCantidad: input.sku.desarmaEnCantidad,
              stockMinimo: input.sku.stockMinimo,
              stockObjetivo: input.sku.stockObjetivo,
            },
            proveedores: input.proveedores,
          })
        : await crearProductoYSku(input);

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
        <h1 className="text-[15px] font-semibold text-text">
          {editando ? "Editar producto" : "Nuevo producto"}
        </h1>
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

        {/* Editando no hay nada que elegir: el producto ya es este, y lo que
            se hace acá es corregirle el nombre, la marca o la categoría. */}
        {!editando && (
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
        )}

        {/* Cada presentación se edita sola (pedido del usuario 2026-10-08).
            Si este producto tiene otras, cambiarle el nombre acá separa esta
            en un producto propio en vez de renombrarlas a todas. */}
        {editando && (skuEditar?.hermanas ?? 0) > 0 && (
          <p className="mb-3 rounded-[6px] bg-info-bg px-[10px] py-[8px] text-[12.5px] text-info">
            Este producto tiene {skuEditar!.hermanas}{" "}
            {skuEditar!.hermanas === 1 ? "presentación más" : "presentaciones más"}. Si cambiás el
            nombre, la marca o la categoría, esta se separa en un producto propio y las otras quedan
            como están.
          </p>
        )}

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
              placeholder="Lo numera el sistema"
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
          
            {/* Multiplica el recargo de Laprida (monto fijo x unidades
                contenidas), así que un número de más acá sale caro y no se
                nota hasta que alguien mira un ticket. Se avisa, no se
                bloquea: mismo criterio que el precio bajo costo. */}
            {tipoPresentacion === "unidad" && Number(unidadesContenidas) !== 1 && (
              <p className="mt-[4px] text-[11.5px] text-warn">
                Una unidad suelta contiene 1. Con {unidadesContenidas} acá, el recargo de Laprida
                para este producto se multiplica por {unidadesContenidas}.
              </p>
            )}
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

        {seDesarma && !editando && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={modoBtnClass(desarmaModo === "nueva")}
              onClick={() => setDesarmaModo("nueva")}
            >
              Crearla ahora
            </button>
            <button
              type="button"
              className={modoBtnClass(desarmaModo === "existente")}
              onClick={() => setDesarmaModo("existente")}
            >
              Ya existe en el catálogo
            </button>
          </div>
        )}

        {seDesarma && !editando && desarmaModo === "nueva" && (
          <div className="mt-3">
            {derivados.length === 0 && (
              <p className="mb-2 text-[12px] text-text-3">
                Agregá en qué se desarma este pack. Se crea como producto nuevo con su propio
                código de barras y su propio stock, sin salir de esta pantalla.
              </p>
            )}

            {derivados.map((d, i) => (
              <div key={i} className="mb-2 rounded-[6px] border border-border bg-bg-2 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-text-2">
                    {i === 0 ? "Se desarma en" : "Y eso se desarma en"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDerivados(derivados.slice(0, i))}
                    className="text-[11.5px] text-text-3 hover:text-err"
                  >
                    Quitar
                  </button>
                </div>

                <div className="grid grid-cols-[1fr_120px] gap-2">
                  <div>
                    <label className={labelClass}>Nombre *</label>
                    <input
                      type="text"
                      value={d.nombre}
                      onChange={(e) =>
                        setDerivados(
                          derivados.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)),
                        )
                      }
                      placeholder="Ej. Quilmes Clásica pack x6"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Cuántas produce *</label>
                    <input
                      type="number"
                      min={1}
                      value={d.factor}
                      onChange={(e) =>
                        setDerivados(
                          derivados.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)),
                        )
                      }
                      className={`${inputClass} tabular-nums`}
                    />
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-[1fr_140px_120px] gap-2">
                  <div>
                    <label className={labelClass}>Código de barras</label>
                    <input
                      type="text"
                      value={d.codigoBarras}
                      onChange={(e) =>
                        setDerivados(
                          derivados.map((x, j) =>
                            j === i ? { ...x, codigoBarras: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Escaneálo acá (opcional)"
                      className={`${inputClass} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Presentación</label>
                    <select
                      value={d.tipoPresentacion}
                      onChange={(e) =>
                        setDerivados(
                          derivados.map((x, j) =>
                            j === i
                              ? { ...x, tipoPresentacion: e.target.value as DerivadoForm["tipoPresentacion"] }
                              : x,
                          ),
                        )
                      }
                      className={inputClass}
                    >
                      <option value="unidad">Unidad</option>
                      <option value="pack">Pack</option>
                      <option value="cajon">Cajón</option>
                      <option value="estuche">Estuche</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Unidades *</label>
                    <input
                      type="number"
                      min={1}
                      value={d.unidadesContenidas}
                      onChange={(e) =>
                        setDerivados(
                          derivados.map((x, j) =>
                            j === i ? { ...x, unidadesContenidas: e.target.value } : x,
                          ),
                        )
                      }
                      className={`${inputClass} tabular-nums`}
                    />
                  </div>
                </div>
              </div>
            ))}

            {derivados.length < 2 && (
              <button
                type="button"
                onClick={() =>
                  setDerivados([...derivados, derivadoPorNivel(derivados.length, nombreProductoActual)])
                }
                className={modoBtnClass(false)}
              >
                {derivados.length === 0 ? "+ En qué se desarma" : "+ Y eso también se desarma"}
              </button>
            )}

            {/* El volumen y la unidad no se piden: una lata de 354 ml sigue
                siendo de 354 ml suelta o en un pack, así que se heredan del
                pack principal. El envase retornable y los mínimos de stock
                se cargan después (Editar / Carga inicial). */}
            {derivados.length > 0 && (
              <p className="mt-2 text-[11.5px] text-text-3">
                Heredan el producto, la marca y el contenido ({volumen || "—"} {unidadVolumen}). El
                stock se carga después, al contar.
              </p>
            )}
          </div>
        )}

        {seDesarma && desarmaModo === "existente" && (
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
          {pending ? "Guardando…" : editando ? "Guardar cambios" : "Guardar producto"}
        </button>
      </div>
    </div>
  );
}
