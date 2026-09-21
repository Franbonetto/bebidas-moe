"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { crearPedidoCompra, type LineaPedidoCompra } from "../actions";

export type SugerenciaCompraSku = {
  sku_id: string;
  stock_actual: number;
  en_camino: number;
  stock_objetivo: number;
  sugerido: number;
  sku: SkuPresentacion & {
    codigo_interno: string;
    producto: { nombre: string; marca: { nombre: string } | null } | null;
  };
};

type Proveedor = { id: string; nombre: string };

const SIN_PROVEEDOR_ID = "__sin_proveedor__";

export function SugerenciaCompraForm({
  filas,
  proveedoresPorSku,
}: {
  filas: SugerenciaCompraSku[];
  proveedoresPorSku: Record<string, Proveedor[]>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, number>>(
    Object.fromEntries(filas.map((f) => [f.sku_id, f.sugerido])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Un SKU sin proveedor cargado queda en su propio grupo; uno con más de
  // un proveedor aparece repetido en cada grupo al que pertenece (decisión
  // del usuario 2026-09-21: refleja el modelo real, no inventa un
  // "principal" que no existe en proveedor_skus).
  const grupos = useMemo(() => {
    const porProveedor = new Map<string, { proveedor: Proveedor; filas: SugerenciaCompraSku[] }>();
    for (const f of filas) {
      const proveedores = proveedoresPorSku[f.sku_id];
      if (!proveedores || proveedores.length === 0) {
        const grupo = porProveedor.get(SIN_PROVEEDOR_ID) ?? {
          proveedor: { id: SIN_PROVEEDOR_ID, nombre: "Sin proveedor asignado" },
          filas: [],
        };
        grupo.filas.push(f);
        porProveedor.set(SIN_PROVEEDOR_ID, grupo);
        continue;
      }
      for (const proveedor of proveedores) {
        const grupo = porProveedor.get(proveedor.id) ?? { proveedor, filas: [] };
        grupo.filas.push(f);
        porProveedor.set(proveedor.id, grupo);
      }
    }
    return [...porProveedor.values()].sort((a, b) => {
      if (a.proveedor.id === SIN_PROVEEDOR_ID) return 1;
      if (b.proveedor.id === SIN_PROVEEDOR_ID) return -1;
      return a.proveedor.nombre.localeCompare(b.proveedor.nombre, "es");
    });
  }, [filas, proveedoresPorSku]);

  function coincide(f: SugerenciaCompraSku, q: string) {
    const producto = f.sku.producto?.nombre.toLowerCase() ?? "";
    const marca = f.sku.producto?.marca?.nombre.toLowerCase() ?? "";
    return producto.includes(q) || marca.includes(q) || f.sku.codigo_interno.toLowerCase().includes(q);
  }

  const q = query.trim().toLowerCase();
  const gruposFiltrados = useMemo(() => {
    return grupos
      .map((g) => {
        const filasGrupo = q ? g.filas.filter((f) => coincide(f, q)) : g.filas;
        const conSugerencia = filasGrupo.filter((f) => f.sugerido > 0);
        const resto = filasGrupo.filter((f) => f.sugerido === 0);
        return { ...g, conSugerencia, resto, total: conSugerencia.length + resto.length };
      })
      .filter((g) => g.total > 0);
  }, [grupos, q]);

  const sinResultados = gruposFiltrados.length === 0;
  const totalConSugerencia = useMemo(() => filas.filter((f) => f.sugerido > 0).length, [filas]);

  function renderFila(f: SugerenciaCompraSku, proveedorId: string) {
    return (
      <tr key={`${proveedorId}-${f.sku_id}`} className="border-b border-[#F1F1F3] last:border-b-0">
        <td className="px-[14px] py-[9px] align-middle">
          <p className="font-medium text-text">{f.sku.producto?.nombre}</p>
          <p className="text-[11.5px] text-text-3">
            {f.sku.producto?.marca?.nombre} — {presentacionLabel(f.sku)}
          </p>
        </td>
        <td
          className={`px-[14px] py-[9px] text-right align-middle tabular-nums ${
            f.stock_actual <= 0 ? "font-medium text-err" : "text-text-2"
          }`}
        >
          {f.stock_actual}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.stock_objetivo}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.en_camino}
        </td>
        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
          {f.sugerido}
        </td>
        <td className="px-[14px] py-[9px] align-middle">
          <input
            type="number"
            min={0}
            className="w-[80px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
            value={cantidades[f.sku_id] ?? 0}
            onChange={(e) => setCantidades((prev) => ({ ...prev, [f.sku_id]: Number(e.target.value) }))}
          />
        </td>
      </tr>
    );
  }

  const lineasAPedir = filas.filter((f) => (cantidades[f.sku_id] ?? 0) > 0);
  const totalUnidades = lineasAPedir.reduce((acc, f) => acc + (cantidades[f.sku_id] ?? 0), 0);

  function guardar() {
    if (lineasAPedir.length === 0) {
      setError("No hay ninguna cantidad cargada para pedir.");
      return;
    }
    for (const f of lineasAPedir) {
      const cantidad = cantidades[f.sku_id];
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        setError("Las cantidades tienen que ser enteros mayores a cero.");
        return;
      }
    }

    setError(null);
    const lineas: LineaPedidoCompra[] = lineasAPedir.map((f) => ({
      sku_id: f.sku_id,
      cantidad_sugerida: f.sugerido,
      cantidad_solicitada: cantidades[f.sku_id],
    }));

    startTransition(async () => {
      const resultado = await crearPedidoCompra(lineas);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push(`/pedidos/compra/${resultado.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-4 text-[12.5px] text-text-2">
        Encontramos {totalConSugerencia} producto{totalConSugerencia === 1 ? "" : "s"} que
        podrían necesitar reposición, agrupados por proveedor y precargados con la cantidad
        sugerida. La sugerencia descuenta lo que ya está en camino (compras confirmadas sin recibir
        todavía). Dentro de cada proveedor, debajo está el resto del catálogo por si necesitás
        pedir algo que el sistema no detectó. Podés cambiar cualquier cantidad antes de guardar —
        esto no compra nada, solo arma la lista para que el dueño sepa qué pedirle a cada
        proveedor.
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

        {filas.length === 0 ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">No hay productos en el catálogo</p>
            <p className="text-[12.5px] text-text-3">No hay SKU activos para pedir.</p>
          </div>
        ) : sinResultados ? (
          <div className="px-[14px] py-[26px] text-center">
            <p className="mb-[3px] text-[13.5px] font-semibold text-text">No encontramos productos</p>
            <p className="text-[12.5px] text-text-3">Probá con otra marca, producto o código.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                    Producto
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Stock
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Objetivo
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    En camino
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Sugerido
                  </th>
                  <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                    Pedir
                  </th>
                </tr>
              </thead>
              <tbody>
                {gruposFiltrados.map((g) => (
                  <Fragment key={g.proveedor.id}>
                    <tr>
                      <td
                        colSpan={6}
                        className={`border-b border-border px-[14px] py-[7px] text-[12px] font-semibold ${
                          g.proveedor.id === SIN_PROVEEDOR_ID ? "bg-warn-bg text-warn" : "bg-bg-2 text-text"
                        }`}
                      >
                        {g.proveedor.nombre} · {g.total} producto{g.total === 1 ? "" : "s"}
                      </td>
                    </tr>
                    {g.conSugerencia.map((f) => renderFila(f, g.proveedor.id))}
                    {g.resto.length > 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="border-b border-border bg-bg-2 px-[14px] py-[5px] pl-[24px] text-[11px] font-medium text-text-3"
                        >
                          Resto del catálogo
                        </td>
                      </tr>
                    )}
                    {g.resto.map((f) => renderFila(f, g.proveedor.id))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-[14px] py-[10px]">
          <span className="text-[12.5px] text-text-2">
            {lineasAPedir.length} producto{lineasAPedir.length === 1 ? "" : "s"} ·{" "}
            <b className="text-text">{totalUnidades} unidades</b>
          </span>
          <button
            type="button"
            onClick={guardar}
            disabled={pending}
            className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {pending ? "Guardando…" : "Guardar pedido de compra"}
          </button>
        </div>

        {error && <p className="border-t border-border px-[14px] py-[8px] text-[12.5px] text-err">{error}</p>}
      </div>
    </div>
  );
}
