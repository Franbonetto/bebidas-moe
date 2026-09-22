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
}: {
  skus: SkuCatalogo[];
  excluirIds: Set<string>;
  onSelect: (sku: SkuCatalogo) => void;
}) {
  const [query, setQuery] = useState("");

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

  // Pistola lectora: escanea y manda el código seguido de Enter. Busca por
  // codigo_barras exacto en TODO el catálogo (no solo excluirIds, porque
  // reescanear un SKU que ya está en la lista tiene que sumarle cantidad,
  // no perderse el evento) -- el padre (agregarLinea) decide si suma a una
  // línea existente o crea una nueva.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = query.trim();
    if (!q) return;
    const porCodigoBarras = skus.find((s) => s.codigo_barras === q);
    if (porCodigoBarras) {
      e.preventDefault();
      onSelect(porCodigoBarras);
      setQuery("");
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Escaneá el código de barras o buscá por producto, marca o código…"
        className="w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe"
      />
      {resultados.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-bg">
          {resultados.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s);
                setQuery("");
              }}
              className="block w-full border-b border-[#F1F1F3] px-[10px] py-[7px] text-left text-[13px] last:border-b-0 hover:bg-bg-2"
            >
              <span className="font-medium text-text">{s.producto?.nombre}</span>
              <span className="text-text-3">
                {" "}
                · {s.producto?.marca?.nombre} — {presentacionLabel(s)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
