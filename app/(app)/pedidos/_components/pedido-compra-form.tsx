"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import {
  crearPedidoCompra,
  obtenerMovimientoCompraPorRango,
  type LineaPedidoCompra,
} from "../actions";
import { SelectorRangoVendido, formatoDia, type RangoControl } from "./rango-vendido";

// Pedido de compra semanal de Olavarría (el que arma la empleada y ve el
// dueño). Pedido del usuario 2026-11-10: una lista de TODO lo que se vendió
// en la semana, de mayor a menor, con el stock que hay hoy en el local; al
// tocar un producto, un modal pregunta cuánto se le pide al dueño; y el botón
// de enviar abajo de todo. Se puede filtrar por categoría (y por proveedor,
// que es como el dueño después compra).
//
// Esto no compra nada ni mueve stock: arma la lista para que el dueño sepa
// qué pedirle a cada proveedor (ver 20260909090000_pedidos_compra.sql).

export type SugerenciaCompraSku = {
  sku_id: string;
  stock_actual: number;
  en_camino: number;
  stock_objetivo: number;
  sugerido: number;
  sku: SkuPresentacion & {
    codigo_interno: string;
    producto: {
      nombre: string;
      marca: { nombre: string } | null;
      categoria: { nombre: string } | null;
    } | null;
  };
};

type Proveedor = { id: string; nombre: string };

const SIN_PROVEEDOR_ID = "__sin_proveedor__";

const thBase =
  "whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2";

const selectClass =
  "rounded-[6px] border border-border bg-bg px-[8px] py-[5px] text-[13px] text-text outline-none focus:border-moe";

function nombreProducto(f: SugerenciaCompraSku) {
  return f.sku.producto?.nombre ?? f.sku.codigo_interno;
}

function subtituloProducto(f: SugerenciaCompraSku) {
  return [f.sku.producto?.marca?.nombre, presentacionLabel(f.sku)].filter(Boolean).join(" — ");
}

function porNombre(a: SugerenciaCompraSku, b: SugerenciaCompraSku) {
  const marcaA = a.sku.producto?.marca?.nombre ?? "";
  const marcaB = b.sku.producto?.marca?.nombre ?? "";
  if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");
  const productoA = a.sku.producto?.nombre ?? "";
  const productoB = b.sku.producto?.nombre ?? "";
  if (productoA !== productoB) return productoA.localeCompare(productoB, "es");
  return a.sku.unidades_contenidas - b.sku.unidades_contenidas;
}

export function PedidoCompraForm({
  filas,
  proveedoresPorSku,
  proveedores: todosLosProveedoresActivos,
  vendidoInicial,
  aLapridaInicial,
  desdeInicial,
  hoy,
}: {
  filas: SugerenciaCompraSku[];
  proveedoresPorSku: Record<string, Proveedor[]>;
  // Todos los proveedores activos (no solo los que ya tienen productos).
  proveedores: Proveedor[];
  // Lo vendido y lo mandado a Laprida desde el lunes hasta ahora.
  vendidoInicial: Record<string, number>;
  aLapridaInicial: Record<string, number>;
  // Lunes de esta semana (AAAA-MM-DD) y hoy.
  desdeInicial: string;
  hoy: string;
}) {
  const router = useRouter();

  // --- Rango de fechas ------------------------------------------------
  const [vendido, setVendido] = useState(vendidoInicial);
  const [aLaprida, setALaprida] = useState(aLapridaInicial);
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hoy);
  const [rangoAplicado, setRangoAplicado] = useState<{ desde: string; hasta: string } | null>(null);
  const [cargandoRango, setCargandoRango] = useState(false);
  const [errorRango, setErrorRango] = useState<string | null>(null);

  const leyenda = rangoAplicado
    ? `Mostrando lo vendido del ${formatoDia(rangoAplicado.desde)} al ${formatoDia(rangoAplicado.hasta)}.`
    : `Mostrando lo vendido esta semana, desde el lunes ${formatoDia(desdeInicial)}.`;

  async function aplicarRango() {
    setErrorRango(null);
    if (!desde || !hasta) {
      setErrorRango("Elegí las dos fechas.");
      return;
    }
    if (desde > hasta) {
      setErrorRango('La fecha "desde" no puede ser posterior a "hasta".');
      return;
    }

    setCargandoRango(true);
    const resultado = await obtenerMovimientoCompraPorRango(desde, hasta);
    setCargandoRango(false);

    if ("error" in resultado) {
      setErrorRango(resultado.error);
      return;
    }
    setVendido(resultado.vendido);
    setALaprida(resultado.aLaprida);
    setRangoAplicado({ desde, hasta });
  }

  function volverALaSemana() {
    setErrorRango(null);
    setVendido(vendidoInicial);
    setALaprida(aLapridaInicial);
    setRangoAplicado(null);
    setDesde(desdeInicial);
    setHasta(hoy);
  }

  const rango: RangoControl = {
    desde,
    setDesde,
    hasta,
    setHasta,
    rangoAplicado,
    cargando: cargandoRango,
    error: errorRango,
    leyenda,
    aplicar: aplicarRango,
    volver: volverALaSemana,
  };

  // --- Filtros --------------------------------------------------------
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [verTodos, setVerTodos] = useState(false);

  const categorias = useMemo(() => {
    const nombres = new Set<string>();
    for (const f of filas) {
      const c = f.sku.producto?.categoria?.nombre;
      if (c) nombres.add(c);
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
  }, [filas]);

  const proveedores = useMemo(
    () => [...todosLosProveedoresActivos].sort((x, y) => x.nombre.localeCompare(y.nombre, "es")),
    [todosLosProveedoresActivos],
  );

  // --- Lo que se va a pedir -------------------------------------------
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  // Proveedor elegido y nota de cada producto ("" = sin elegir / sin nota).
  const [proveedorDe, setProveedorDe] = useState<Record<string, string>>({});
  const [notaDe, setNotaDe] = useState<Record<string, string>>({});
  const [nota, setNota] = useState("");
  const [modalSku, setModalSku] = useState<SugerenciaCompraSku | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filas.filter((f) => {
      if (categoria && f.sku.producto?.categoria?.nombre !== categoria) return false;
      if (proveedor) {
        const delSku = proveedoresPorSku[f.sku_id] ?? [];
        if (proveedor === SIN_PROVEEDOR_ID) {
          if (delSku.length > 0) return false;
        } else if (!delSku.some((p) => p.id === proveedor)) {
          return false;
        }
      }
      if (q) {
        const producto = f.sku.producto?.nombre.toLowerCase() ?? "";
        const marca = f.sku.producto?.marca?.nombre.toLowerCase() ?? "";
        if (!(producto.includes(q) || marca.includes(q) || f.sku.codigo_interno.toLowerCase().includes(q))) {
          return false;
        }
      }
      return true;
    });
  }, [filas, query, categoria, proveedor, proveedoresPorSku]);

  const esVendido = (f: SugerenciaCompraSku) =>
    (vendido[f.sku_id] ?? 0) > 0 || (cantidades[f.sku_id] ?? 0) > 0;

  // De mayor a menor venta (pedido del usuario); a igual venta, por nombre.
  const vendidos = useMemo(
    () =>
      filtradas
        .filter(esVendido)
        .sort((a, b) => (vendido[b.sku_id] ?? 0) - (vendido[a.sku_id] ?? 0) || porNombre(a, b)),
    // esVendido depende de vendido y cantidades
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtradas, vendido, cantidades],
  );

  const sinVentas = useMemo(
    () =>
      filtradas
        .filter((f) => !esVendido(f))
        // Los que el sistema ve por debajo del objetivo, primero.
        .sort((a, b) => Number(b.sugerido > 0) - Number(a.sugerido > 0) || porNombre(a, b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtradas, vendido, cantidades],
  );

  const sinVentasBajoObjetivo = sinVentas.filter((f) => f.sugerido > 0).length;
  const otros = verTodos ? sinVentas : [];

  const lineasAPedir = filas.filter((f) => (cantidades[f.sku_id] ?? 0) > 0);
  const totalUnidades = lineasAPedir.reduce((acc, f) => acc + (cantidades[f.sku_id] ?? 0), 0);

  function guardarLinea(
    f: SugerenciaCompraSku,
    linea: { cantidad: number; proveedorId: string; nota: string },
  ) {
    setCantidades((prev) => {
      const siguiente = { ...prev };
      if (linea.cantidad > 0) siguiente[f.sku_id] = linea.cantidad;
      else delete siguiente[f.sku_id];
      return siguiente;
    });
    setProveedorDe((prev) => ({ ...prev, [f.sku_id]: linea.proveedorId }));
    setNotaDe((prev) => ({ ...prev, [f.sku_id]: linea.nota.trim() }));
    setError(null);
    setModalSku(null);
  }

  const nombreProveedor = useMemo(
    () => new Map(proveedores.map((p) => [p.id, p.nombre])),
    [proveedores],
  );

  // Proveedor con el que se arma la línea cuando todavía no se eligió: el
  // único que tiene el producto, o el del filtro si el producto es de ese
  // proveedor. Si hay más de uno, lo elige la persona.
  function proveedorSugerido(f: SugerenciaCompraSku): string {
    const delSku = proveedoresPorSku[f.sku_id] ?? [];
    if (proveedor && proveedor !== SIN_PROVEEDOR_ID && delSku.some((p) => p.id === proveedor)) {
      return proveedor;
    }
    return delSku.length === 1 ? delSku[0].id : "";
  }

  function proveedorDeLinea(f: SugerenciaCompraSku): string {
    return proveedorDe[f.sku_id] ?? proveedorSugerido(f);
  }

  // Atajo: carga la cantidad que sugiere el sistema en lo que se ve en
  // pantalla, sin pisar lo que ya se cargó a mano.
  function cargarSugeridas() {
    const nuevas = [...vendidos, ...otros].filter(
      (f) => f.sugerido > 0 && !((cantidades[f.sku_id] ?? 0) > 0),
    );
    setCantidades((prev) => {
      const siguiente = { ...prev };
      for (const f of nuevas) siguiente[f.sku_id] = f.sugerido;
      return siguiente;
    });
    // El proveedor queda fijo al cargar, así no cambia si después se mueve
    // el filtro de proveedor.
    setProveedorDe((prev) => {
      const siguiente = { ...prev };
      for (const f of nuevas) {
        if (siguiente[f.sku_id] === undefined) siguiente[f.sku_id] = proveedorSugerido(f);
      }
      return siguiente;
    });
    setError(null);
  }

  // Cuántos productos del pedido quedan en cada proveedor, para avisar antes
  // de enviar si hay alguno sin proveedor.
  const sinProveedorElegido = lineasAPedir.filter((f) => proveedorDeLinea(f) === "").length;

  const haySugeridasParaCargar = [...vendidos, ...otros].some(
    (f) => f.sugerido > 0 && !((cantidades[f.sku_id] ?? 0) > 0),
  );

  function enviar() {
    if (lineasAPedir.length === 0) {
      setError("Todavía no cargaste cuánto pedir de ningún producto.");
      return;
    }

    setError(null);
    const lineas: LineaPedidoCompra[] = lineasAPedir.map((f) => ({
      sku_id: f.sku_id,
      cantidad_sugerida: f.sugerido,
      cantidad_solicitada: cantidades[f.sku_id],
      proveedor_id: proveedorDeLinea(f) || null,
      nota: notaDe[f.sku_id] || null,
    }));

    startTransition(async () => {
      const resultado = await crearPedidoCompra(lineas, nota);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push(`/pedidos/compra/${resultado.id}`);
    });
  }

  function renderFila(f: SugerenciaCompraSku) {
    const aPedir = cantidades[f.sku_id] ?? 0;
    const mandado = aLaprida[f.sku_id] ?? 0;
    return (
      <tr
        key={f.sku_id}
        onClick={() => setModalSku(f)}
        className="cursor-pointer border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]"
      >
        <td className="px-[14px] py-[9px] align-middle">
          <p className="font-medium text-text">{nombreProducto(f)}</p>
          <p className="text-[11.5px] text-text-3">
            {subtituloProducto(f)}
            {f.sku.producto?.categoria?.nombre ? ` · ${f.sku.producto.categoria.nombre}` : ""}
          </p>
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-text">
          {vendido[f.sku_id] ?? 0}
        </td>
        <td
          className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
            f.stock_actual <= 0 ? "font-medium text-err" : "text-text-2"
          }`}
        >
          {f.stock_actual}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.en_camino > 0 ? <span className="text-info">{f.en_camino}</span> : "—"}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {mandado > 0 ? mandado : "—"}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setModalSku(f);
            }}
            className={
              aPedir > 0
                ? "rounded-[6px] bg-moe-soft px-[10px] py-[4px] text-[13px] font-semibold tabular-nums text-moe"
                : "rounded-[6px] border border-border bg-bg px-[10px] py-[4px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
            }
          >
            {aPedir > 0 ? `${aPedir} a pedir` : "Cargar"}
          </button>
          {aPedir > 0 && (
            <p className="mt-[3px] truncate text-[11px] text-text-3">
              {nombreProveedor.get(proveedorDeLinea(f)) ?? "Sin proveedor"}
              {notaDe[f.sku_id] ? " · con nota" : ""}
            </p>
          )}
        </td>
      </tr>
    );
  }

  const sinProductos = filas.length === 0;
  const sinResultados = vendidos.length === 0 && otros.length === 0;
  const hayFiltros = Boolean(query.trim() || categoria || proveedor);

  // Con un proveedor elegido, explicar por qué no hay nada: si todavía no
  // tiene productos asociados, o si los tiene pero ninguno se vendió en el
  // período.
  const proveedorElegido =
    proveedor && proveedor !== SIN_PROVEEDOR_ID ? nombreProveedor.get(proveedor) ?? null : null;
  const productosDelProveedor = proveedorElegido
    ? filas.filter((f) => (proveedoresPorSku[f.sku_id] ?? []).some((p) => p.id === proveedor)).length
    : 0;
  const textoSinResultados = (() => {
    if (proveedorElegido && productosDelProveedor === 0) {
      return {
        titulo: `${proveedorElegido} todavía no tiene productos`,
        sub: "No tiene productos asociados ni compras cargadas. Se asocian desde Productos, al editar un producto, o aparecen solos cuando se le carga una compra.",
      };
    }
    if (proveedorElegido && !query.trim() && !categoria) {
      return {
        titulo: `Ningún producto de ${proveedorElegido} se vendió en este período`,
        sub: `Tiene ${productosDelProveedor} producto${productosDelProveedor === 1 ? "" : "s"}. Probá con otras fechas, o marcá "Ver también lo que no se vendió" para cargarlos igual.`,
      };
    }
    if (hayFiltros) {
      return {
        titulo: "No encontramos productos",
        sub: "Probá con otra categoría, proveedor o búsqueda, o limpiá los filtros.",
      };
    }
    return {
      titulo: "No se vendió nada en este período",
      sub: 'Probá con otras fechas, o marcá "Ver también lo que no se vendió" para cargar cualquier producto.',
    };
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-4 text-[12.5px] text-text-2">
        Esta es la lista de todo lo que se vendió en el local, de lo más vendido a lo menos vendido,
        con el stock que hay hoy. Tocá un producto para cargar cuánto le pedís al dueño y, cuando
        termines, apretá "Enviar al dueño" abajo de todo. Esto no compra nada: arma la lista para
        que el dueño sepa qué pedirle a cada proveedor.
      </div>

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
          <h2 className="text-[13px] font-semibold text-text">Pedido de compra semanal</h2>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por producto, marca o código…"
            className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
        </div>

        <SelectorRangoVendido
          rango={rango}
          etiquetaDesde="Vendido desde"
          textoVolver="Volver a esta semana"
        />

        <div className="flex flex-wrap items-center gap-3 border-b border-border px-[14px] py-[9px]">
          <label className="flex items-center gap-[6px] text-[12px] font-medium text-text-2">
            Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={selectClass}>
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-[6px] text-[12px] font-medium text-text-2">
            Proveedor
            <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={selectClass}>
              <option value="">Todos</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
              <option value={SIN_PROVEEDOR_ID}>Sin proveedor asignado</option>
            </select>
          </label>
          {hayFiltros && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategoria("");
                setProveedor("");
              }}
              className="text-[12.5px] font-medium text-moe hover:underline"
            >
              Limpiar filtros
            </button>
          )}
          <span className="flex-1" />
          {haySugeridasParaCargar && (
            <button
              type="button"
              onClick={cargarSugeridas}
              className="text-[12.5px] font-medium text-moe hover:underline"
              title="Carga lo que sugiere el sistema (hasta el stock objetivo) en los productos que ves, sin pisar lo que ya cargaste"
            >
              Cargar las cantidades sugeridas
            </button>
          )}
          <label className="flex items-center gap-[6px] text-[12.5px] text-text-2">
            <input
              type="checkbox"
              checked={verTodos}
              onChange={(e) => setVerTodos(e.target.checked)}
              className="accent-[#C8201A]"
            />
            Ver también lo que no se vendió
          </label>
        </div>

        {sinProductos ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">No hay productos en el catálogo</p>
            <p className="text-[12.5px] text-text-3">No hay SKU activos para pedir.</p>
          </div>
        ) : sinResultados ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">{textoSinResultados.titulo}</p>
            <p className="text-[12.5px] text-text-3">{textoSinResultados.sub}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Producto
                  </th>
                  <th className={thBase} title="Unidades vendidas en el período, de mayor a menor">
                    Vendió ↓
                  </th>
                  <th className={thBase} title="Stock que hay hoy en el local">
                    Hay en el local
                  </th>
                  <th className={thBase} title="Ya comprado y todavía sin recibir">
                    En camino
                  </th>
                  <th
                    className={thBase}
                    title="Lo que se mandó a Laprida en el período: sale del stock pero no es una venta"
                  >
                    Mandado a Laprida
                  </th>
                  <th className={thBase}>¿Cuánto pedís?</th>
                </tr>
              </thead>
              <tbody>
                {vendidos.map((f) => renderFila(f))}

                {otros.length > 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="border-b border-border bg-bg-2 px-[14px] py-[6px] text-[11.5px] font-medium text-text-2"
                    >
                      No se vendieron en este período
                      {sinVentasBajoObjetivo > 0 && ` · los primeros ${sinVentasBajoObjetivo} están por debajo del stock objetivo`}
                    </td>
                  </tr>
                )}
                {otros.map((f) => renderFila(f))}
              </tbody>
            </table>
          </div>
        )}

        {!verTodos && sinVentasBajoObjetivo > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-warn-bg px-[14px] py-[8px] text-[12.5px] text-warn">
            <span>
              {sinVentasBajoObjetivo} producto{sinVentasBajoObjetivo === 1 ? "" : "s"} sin ventas en
              este período {sinVentasBajoObjetivo === 1 ? "está" : "están"} por debajo del stock
              objetivo.
            </span>
            <button
              type="button"
              onClick={() => setVerTodos(true)}
              className="font-medium underline hover:no-underline"
            >
              Verlos
            </button>
          </div>
        )}

        {/* Abajo de todo: nota opcional y el botón de enviar. */}
        <div className="flex flex-col gap-3 border-t border-border px-[14px] py-[12px]">
          <label className="flex flex-col gap-[4px] text-[12px] font-medium text-text-2">
            Nota para el dueño (opcional)
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Por ejemplo: llega fin de semana largo, hay promo de cerveza…"
              className="resize-y rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[13px] font-normal text-text outline-none focus:border-moe"
            />
          </label>
          {sinProveedorElegido > 0 && (
            <p className="text-[12px] text-warn">
              {sinProveedorElegido} producto{sinProveedorElegido === 1 ? "" : "s"} sin proveedor
              elegido: el dueño {sinProveedorElegido === 1 ? "lo ve" : "los ve"} en &quot;Sin
              proveedor asignado&quot;. Tocá el producto para elegir uno.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] text-text-2">
              {lineasAPedir.length} producto{lineasAPedir.length === 1 ? "" : "s"} ·{" "}
              <b className="text-text">{totalUnidades} unidades</b> para pedir
            </span>
            <button
              type="button"
              onClick={enviar}
              disabled={pending || lineasAPedir.length === 0}
              className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
            >
              {pending ? "Enviando…" : "Enviar al dueño"}
            </button>
          </div>
        </div>

        {error && <p className="border-t border-border px-[14px] py-[8px] text-[12.5px] text-err">{error}</p>}
      </div>

      {modalSku && (
        <ModalCantidad
          key={modalSku.sku_id}
          f={modalSku}
          vendido={vendido[modalSku.sku_id] ?? 0}
          mandadoALaprida={aLaprida[modalSku.sku_id] ?? 0}
          actual={cantidades[modalSku.sku_id] ?? 0}
          proveedorInicial={proveedorDeLinea(modalSku)}
          notaInicial={notaDe[modalSku.sku_id] ?? ""}
          proveedoresDelSku={proveedoresPorSku[modalSku.sku_id] ?? []}
          todosLosProveedores={proveedores}
          onGuardar={(linea) => guardarLinea(modalSku, linea)}
          onCancelar={() => setModalSku(null)}
        />
      )}
    </div>
  );
}

function ModalCantidad({
  f,
  vendido,
  mandadoALaprida,
  actual,
  proveedorInicial,
  notaInicial,
  proveedoresDelSku,
  todosLosProveedores,
  onGuardar,
  onCancelar,
}: {
  f: SugerenciaCompraSku;
  vendido: number;
  mandadoALaprida: number;
  actual: number;
  proveedorInicial: string;
  notaInicial: string;
  proveedoresDelSku: Proveedor[];
  todosLosProveedores: Proveedor[];
  onGuardar: (linea: { cantidad: number; proveedorId: string; nota: string }) => void;
  onCancelar: () => void;
}) {
  const [valor, setValor] = useState(actual > 0 ? String(actual) : "");
  const [proveedorId, setProveedorId] = useState(proveedorInicial);
  const [notaLinea, setNotaLinea] = useState(notaInicial);

  const texto = valor.trim();
  const numero = texto === "" ? 0 : Number(texto);
  const esEntero = Number.isInteger(numero) && numero >= 0;

  const idsDelSku = new Set(proveedoresDelSku.map((p) => p.id));
  const otrosProveedores = todosLosProveedores.filter((p) => !idsDelSku.has(p.id));

  function guardar() {
    if (esEntero) onGuardar({ cantidad: numero, proveedorId, nota: notaLinea });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancelar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Cuánto pedir de ${nombreProducto(f)}`}
        className="w-[380px] max-w-full rounded-card border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15.5px] font-semibold text-text">{nombreProducto(f)}</h2>
        <p className="mb-3 text-[12.5px] text-text-3">{subtituloProducto(f)}</p>

        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-[8px] bg-bg-2 px-[8px] py-[8px]">
            <p className="text-[11px] text-text-3">Vendió</p>
            <p className="text-[18px] font-semibold tabular-nums text-text">{vendido}</p>
          </div>
          <div className="rounded-[8px] bg-bg-2 px-[8px] py-[8px]">
            <p className="text-[11px] text-text-3">Hay en el local</p>
            <p
              className={`text-[18px] font-semibold tabular-nums ${
                f.stock_actual <= 0 ? "text-err" : "text-text"
              }`}
            >
              {f.stock_actual}
            </p>
          </div>
          <div className="rounded-[8px] bg-bg-2 px-[8px] py-[8px]">
            <p className="text-[11px] text-text-3">En camino</p>
            <p className={`text-[18px] font-semibold tabular-nums ${f.en_camino > 0 ? "text-info" : "text-text"}`}>
              {f.en_camino}
            </p>
          </div>
        </div>

        {(mandadoALaprida > 0 || f.sugerido > 0) && (
          <div className="mb-3 flex flex-col gap-[4px] text-[12.5px] text-text-2">
            {mandadoALaprida > 0 && (
              <p>
                En el período mandaste <b className="text-text">{mandadoALaprida}</b> a Laprida.
              </p>
            )}
            {f.sugerido > 0 && (
              <p className="flex flex-wrap items-center gap-2">
                <span>
                  El sistema sugiere <b className="text-text">{f.sugerido}</b> (para llegar al stock
                  objetivo de {f.stock_objetivo}).
                </span>
                <button
                  type="button"
                  onClick={() => setValor(String(f.sugerido))}
                  className="font-medium text-moe hover:underline"
                >
                  Usar {f.sugerido}
                </button>
              </p>
            )}
          </div>
        )}

        <label className="mb-1 block text-[13px] font-medium text-text" htmlFor="cantidad-pedido">
          ¿Cuánto le pedís al dueño?
        </label>
        <input
          id="cantidad-pedido"
          type="number"
          inputMode="numeric"
          min={0}
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              guardar();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancelar();
            }
          }}
          placeholder="0"
          className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[8px] text-center text-[20px] font-semibold tabular-nums text-text outline-none focus:border-moe"
        />

        {!esEntero && texto !== "" && (
          <p className="mt-2 text-[12.5px] text-err">Poné un número entero, sin decimales.</p>
        )}

        <label className="mb-1 mt-3 block text-[13px] font-medium text-text" htmlFor="proveedor-pedido">
          ¿A qué proveedor?
        </label>
        <select
          id="proveedor-pedido"
          value={proveedorId}
          onChange={(e) => setProveedorId(e.target.value)}
          className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[7px] text-[13px] text-text outline-none focus:border-moe"
        >
          <option value="">Sin elegir (queda en &quot;Sin proveedor asignado&quot;)</option>
          {proveedoresDelSku.length > 0 && (
            <optgroup label="Proveedores de este producto">
              {proveedoresDelSku.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </optgroup>
          )}
          {otrosProveedores.length > 0 && (
            <optgroup label="Otros proveedores">
              {otrosProveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <label className="mb-1 mt-3 block text-[13px] font-medium text-text" htmlFor="nota-pedido">
          Nota para el dueño <span className="font-normal text-text-3">(opcional)</span>
        </label>
        <input
          id="nota-pedido"
          type="text"
          value={notaLinea}
          onChange={(e) => setNotaLinea(e.target.value)}
          maxLength={200}
          placeholder="Por ejemplo: en promo, pedir la botella chica…"
          className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[13px] text-text outline-none focus:border-moe"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[14px] font-medium text-text-2 hover:bg-bg-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!esEntero}
            className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[14px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {numero > 0 ? "Agregar al pedido" : actual > 0 ? "Quitar del pedido" : "Listo"}
          </button>
        </div>
      </div>
    </div>
  );
}
