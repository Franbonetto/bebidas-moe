"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { iniciarInventario } from "../actions";
import { TIPO_INVENTARIO_LABEL, type TipoInventario } from "./estado-inventario-badge";

export type CatalogoSku = SkuPresentacion & {
  id: string;
  codigo_interno: string;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type Sucursal = { id: string; nombre: string };
type Categoria = { id: string; nombre: string };

const TIPOS: { tipo: TipoInventario; descripcion: string }[] = [
  { tipo: "general", descripcion: "Todo el catálogo activo. Una o dos veces al año." },
  { tipo: "categoria", descripcion: "Una categoría entera. Rotativo, por ejemplo una por mes." },
  { tipo: "puntual", descripcion: "Solo los productos que elijas. Para cuando algo no cierra." },
];

export function NuevoInventarioForm({
  sucursales,
  categorias,
  skus,
  inventarioAbiertoPorSucursal,
  sugeridosPorSucursal,
}: {
  sucursales: Sucursal[];
  categorias: Categoria[];
  skus: CatalogoSku[];
  inventarioAbiertoPorSucursal: Record<string, string | null>;
  sugeridosPorSucursal: Record<string, string[]>;
}) {
  const router = useRouter();
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [tipo, setTipo] = useState<TipoInventario | null>(null);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inventarioAbiertoId = inventarioAbiertoPorSucursal[sucursalId] ?? null;
  const sucursalNombre = sucursales.find((s) => s.id === sucursalId)?.nombre ?? "";
  const sugeridos = useMemo(
    () => new Set(sugeridosPorSucursal[sucursalId] ?? []),
    [sugeridosPorSucursal, sucursalId],
  );

  function elegirTipo(t: TipoInventario) {
    setTipo(t);
    setCategoriaId(null);
    if (t === "puntual") {
      setSeleccionados(Object.fromEntries(Array.from(sugeridos).map((id) => [id, true])));
    } else {
      setSeleccionados({});
    }
  }

  function coincide(s: CatalogoSku, q: string) {
    const producto = s.producto?.nombre.toLowerCase() ?? "";
    const marca = s.producto?.marca?.nombre.toLowerCase() ?? "";
    return producto.includes(q) || marca.includes(q) || s.codigo_interno.toLowerCase().includes(q);
  }

  const { sugeridosFiltrados, restoFiltrado } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtrar = (arr: CatalogoSku[]) => (q ? arr.filter((s) => coincide(s, q)) : arr);
    return {
      sugeridosFiltrados: filtrar(skus.filter((s) => sugeridos.has(s.id))),
      restoFiltrado: filtrar(skus.filter((s) => !sugeridos.has(s.id))),
    };
  }, [skus, sugeridos, query]);

  const totalSeleccionados = Object.values(seleccionados).filter(Boolean).length;

  function iniciar() {
    if (!tipo) {
      setError("Elegí una modalidad de inventario.");
      return;
    }
    if (tipo === "categoria" && !categoriaId) {
      setError("Elegí una categoría.");
      return;
    }
    if (tipo === "puntual" && totalSeleccionados === 0) {
      setError("Elegí al menos un producto para contar.");
      return;
    }

    setError(null);
    const skuIds =
      tipo === "puntual"
        ? Object.entries(seleccionados)
            .filter(([, v]) => v)
            .map(([id]) => id)
        : null;

    startTransition(async () => {
      const resultado = await iniciarInventario(sucursalId, tipo, categoriaId, skuIds);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      router.push(`/inventarios/${resultado.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-bg p-4">
        <h2 className="mb-2 text-[13px] font-semibold text-text">Sucursal</h2>
        {sucursales.length === 1 ? (
          <p className="text-[13px] text-text">{sucursales[0].nombre}</p>
        ) : (
          <div className="flex gap-2">
            {sucursales.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSucursalId(s.id)}
                className={`rounded-[6px] border px-[12px] py-[7px] text-[13px] font-medium ${
                  s.id === sucursalId
                    ? "border-moe bg-moe-soft text-moe"
                    : "border-border bg-bg text-text-2 hover:bg-bg-2"
                }`}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {inventarioAbiertoId ? (
        <div className="rounded-card border border-border bg-bg p-4">
          <p className="mb-2 text-[13px] font-medium text-text">
            Ya hay un inventario abierto en {sucursalNombre}.
          </p>
          <p className="mb-3 text-[12.5px] text-text-3">
            Hay que terminarlo (o cerrarlo) antes de poder iniciar otro en esta sucursal.
          </p>
          <Link
            href={`/inventarios/${inventarioAbiertoId}`}
            className="inline-block rounded-[6px] bg-moe px-[12px] py-[6px] text-[13px] font-medium text-white hover:bg-moe/90"
          >
            Continuar ese inventario
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-card border border-border bg-bg p-4">
            <h2 className="mb-2 text-[13px] font-semibold text-text">Modalidad</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TIPOS.map((t) => (
                <button
                  key={t.tipo}
                  type="button"
                  onClick={() => elegirTipo(t.tipo)}
                  className={`rounded-[8px] border p-[12px] text-left ${
                    tipo === t.tipo
                      ? "border-moe bg-moe-soft"
                      : "border-border bg-bg hover:bg-bg-2"
                  }`}
                >
                  <p
                    className={`text-[13px] font-semibold ${tipo === t.tipo ? "text-moe" : "text-text"}`}
                  >
                    {TIPO_INVENTARIO_LABEL[t.tipo]}
                  </p>
                  <p className="mt-[2px] text-[12px] text-text-3">{t.descripcion}</p>
                </button>
              ))}
            </div>
          </div>

          {tipo === "categoria" && (
            <div className="rounded-card border border-border bg-bg p-4">
              <h2 className="mb-2 text-[13px] font-semibold text-text">Categoría</h2>
              <select
                value={categoriaId ?? ""}
                onChange={(e) => setCategoriaId(e.target.value || null)}
                className="w-full max-w-[280px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
              >
                <option value="">Elegir categoría…</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tipo === "puntual" && (
            <div className="overflow-hidden rounded-card border border-border bg-bg">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
                <h2 className="text-[13px] font-semibold text-text">Elegir productos</h2>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por producto, marca o código…"
                  className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
                />
              </div>

              {sugeridosFiltrados.length > 0 && (
                <div className="border-b border-border bg-bg-2 px-[14px] py-[6px] text-[11.5px] font-medium text-text-2">
                  Sugeridos (se vendieron con stock en cero)
                </div>
              )}
              {sugeridosFiltrados.map((s) => (
                <SkuCheckboxRow
                  key={s.id}
                  sku={s}
                  checked={Boolean(seleccionados[s.id])}
                  onChange={(v) => setSeleccionados((prev) => ({ ...prev, [s.id]: v }))}
                />
              ))}

              {restoFiltrado.length > 0 && (
                <div className="border-b border-border bg-bg-2 px-[14px] py-[6px] text-[11.5px] font-medium text-text-2">
                  Resto del catálogo
                </div>
              )}
              {restoFiltrado.map((s) => (
                <SkuCheckboxRow
                  key={s.id}
                  sku={s}
                  checked={Boolean(seleccionados[s.id])}
                  onChange={(v) => setSeleccionados((prev) => ({ ...prev, [s.id]: v }))}
                />
              ))}

              {sugeridosFiltrados.length === 0 && restoFiltrado.length === 0 && (
                <div className="px-[14px] py-[20px] text-center text-[12.5px] text-text-3">
                  No encontramos productos con esa búsqueda.
                </div>
              )}

              <div className="border-t border-border px-[14px] py-[8px] text-[12.5px] text-text-2">
                {totalSeleccionados} producto{totalSeleccionados === 1 ? "" : "s"} elegido
                {totalSeleccionados === 1 ? "" : "s"}
              </div>
            </div>
          )}

          {tipo && (
            <div className="flex items-center justify-between rounded-card border border-border bg-bg p-4">
              {error && <p className="text-[12.5px] text-err">{error}</p>}
              <button
                type="button"
                onClick={iniciar}
                disabled={pending}
                className="ml-auto rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                {pending ? "Iniciando…" : "Iniciar inventario"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkuCheckboxRow({
  sku,
  checked,
  onChange,
}: {
  sku: CatalogoSku;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-[10px] border-b border-[#F1F1F3] px-[14px] py-[9px] last:border-b-0 hover:bg-[#FAFAFB]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-moe"
      />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-text">{sku.producto?.nombre}</p>
        <p className="text-[11.5px] text-text-3">
          {sku.producto?.marca?.nombre} — {presentacionLabel(sku)}
        </p>
      </div>
    </label>
  );
}
