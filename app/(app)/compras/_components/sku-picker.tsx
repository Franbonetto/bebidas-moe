"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";

export type SkuCatalogo = SkuPresentacion & {
  id: string;
  codigo_interno: string;
  codigo_barras: string | null;
  producto: {
    nombre: string;
    marca: { nombre: string } | null;
  } | null;
};

export function SkuPicker({
  skus,
  excluirIds,
  onSelect,
  onAsignarCodigoBarras,
}: {
  skus: SkuCatalogo[];
  excluirIds: Set<string>;
  onSelect: (sku: SkuCatalogo) => void;
  // Opcional: si se pasa, un código escaneado que no matchea ningún SKU
  // ofrece buscar el producto y asignárselo ahí mismo (alta progresiva de
  // código de barras, arquitectura.md 1.9). Sin esta prop, un código sin
  // match simplemente no hace nada (comportamiento de antes).
  onAsignarCodigoBarras?: (skuId: string, codigo: string) => Promise<{ error: string } | { ok: true }>;
}) {
  const [query, setQuery] = useState("");
  const [codigoPendiente, setCodigoPendiente] = useState<string | null>(null);
  const [asignando, setAsignando] = useState(false);
  const [errorAsignar, setErrorAsignar] = useState<string | null>(null);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return skus
      .filter((s) => !excluirIds.has(s.id))
      .filter((s) => {
        const producto = s.producto?.nombre.toLowerCase() ?? "";
        const marca = s.producto?.marca?.nombre.toLowerCase() ?? "";
        const codigo = s.codigo_interno.toLowerCase();
        return producto.includes(q) || marca.includes(q) || codigo.includes(q);
      })
      .slice(0, 8);
  }, [skus, excluirIds, query]);

  function cancelarAsignacion() {
    setCodigoPendiente(null);
    setErrorAsignar(null);
  }

  // Pistola lectora: escanea y manda el código seguido de Enter. Busca por
  // codigo_barras exacto en TODO el catálogo (no solo excluirIds, porque
  // reescanear un SKU que ya está en la lista tiene que sumarle cantidad,
  // no perderse el evento) -- el padre (agregarLinea) decide si suma a una
  // línea existente o crea una nueva. Si no matchea nada y hay forma de
  // asignarlo, se ofrece esa vía en vez de perder el escaneo.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = query.trim();
    if (!q) return;
    const porCodigoBarras = skus.find((s) => s.codigo_barras === q);
    if (porCodigoBarras) {
      e.preventDefault();
      onSelect(porCodigoBarras);
      setQuery("");
      return;
    }
    if (onAsignarCodigoBarras && resultados.length === 0) {
      e.preventDefault();
      setCodigoPendiente(q);
      setErrorAsignar(null);
      setQuery("");
    }
  }

  async function elegirParaAsignar(sku: SkuCatalogo) {
    if (!onAsignarCodigoBarras || !codigoPendiente) {
      onSelect(sku);
      setQuery("");
      return;
    }
    setAsignando(true);
    const resultado = await onAsignarCodigoBarras(sku.id, codigoPendiente);
    setAsignando(false);
    if ("error" in resultado) {
      setErrorAsignar(resultado.error);
      return;
    }
    onSelect(sku);
    setQuery("");
    setCodigoPendiente(null);
  }

  return (
    <div className="relative">
      {codigoPendiente && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-[6px] border border-warn/30 bg-warn-bg px-[10px] py-[7px] text-[12px] text-warn">
          <span>
            Código <b>{codigoPendiente}</b> sin asignar — buscá el producto abajo para asociárselo.
          </span>
          <button type="button" onClick={cancelarAsignacion} className="shrink-0 font-medium underline">
            Cancelar
          </button>
        </div>
      )}
      {errorAsignar && <p className="mb-2 text-[12px] text-err">{errorAsignar}</p>}
      <input
        type="text"
        data-testid="sku-picker-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          codigoPendiente
            ? "Buscá el producto por nombre, marca o código…"
            : "Escaneá el código de barras o buscá por producto, marca o código…"
        }
        className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
      />
      {resultados.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-bg">
          {resultados.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={asignando}
              onClick={() => elegirParaAsignar(s)}
              className="block w-full border-b border-[#F1F1F3] px-[10px] py-[7px] text-left text-[13px] last:border-b-0 hover:bg-bg-2 disabled:opacity-60"
            >
              <span className="font-medium text-text">{s.producto?.nombre}</span>
              <span className="text-text-3">
                {" "}
                · {s.producto?.marca?.nombre} — {presentacionLabel(s)}
              </span>
              {codigoPendiente && <span className="ml-1 text-[11px] text-warn">(asignarle el código)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
