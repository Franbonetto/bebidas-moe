"use client";

import { useMemo, useState } from "react";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { Card, EmptyState } from "../../../_components/dashboard/ui";
import { Tabla, Td, Th, Tr } from "../../_components/tabla";

export type RotacionRow = {
  skuId: string;
  nombre: string;
  marcaNombre: string | null;
  // null cuando el SKU vendido ya no existe en el catálogo activo (se
  // vendió y después se desactivó/borró).
  presentacion: SkuPresentacion | null;
  categoriaNombre: string | null;
  unidades: number;
  importe: number;
};

// Pedido del usuario 2026-11-06: filtro de categoría (con "todas las
// categorías") y topes de 30 en vez de 15, tanto para más como para menos
// vendidos. `rows` llega del servidor ya ordenada (desc para "mas", asc
// para "menos") y completa -- el filtro por categoría y el tope de 30 se
// aplican acá para que cambiar de categoría no pida nada al servidor.
const LIMITE = 30;

export function ProductosRotacion({
  rows,
  orden,
}: {
  rows: RotacionRow[];
  orden: "mas" | "menos";
}) {
  const [categoria, setCategoria] = useState("");

  const categorias = useMemo(() => {
    const nombres = new Set<string>();
    for (const r of rows) {
      if (r.categoriaNombre) nombres.add(r.categoriaNombre);
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const filtradas = useMemo(
    () => (categoria ? rows.filter((r) => r.categoriaNombre === categoria) : rows),
    [rows, categoria],
  );

  const mostrar = filtradas.slice(0, LIMITE);

  const selector = (
    <select
      value={categoria}
      onChange={(e) => setCategoria(e.target.value)}
      className="min-w-0 rounded-[6px] border border-border bg-bg-2 px-[8px] py-[4px] text-[12.5px] text-text outline-none focus:border-moe"
    >
      <option value="">Todas las categorías</option>
      {categorias.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );

  return (
    <Card
      title={orden === "mas" ? `Top ${mostrar.length} por unidades` : `Top ${mostrar.length} menos vendidos`}
      action={selector}
    >
      {mostrar.length === 0 ? (
        <EmptyState
          title={orden === "mas" ? "Sin ventas en el período" : "No hay productos para mostrar"}
          sub={
            orden === "mas"
              ? "Todavía no hay ventas confirmadas en este rango."
              : "No hay productos activos en esta categoría."
          }
        />
      ) : (
        <Tabla>
          <thead>
            <tr>
              <Th align="right">#</Th>
              <Th>Producto</Th>
              <Th>Presentación</Th>
              <Th align="right">Unidades</Th>
              <Th align="right">Importe</Th>
            </tr>
          </thead>
          <tbody>
            {mostrar.map((r, i) => (
              <Tr key={r.skuId}>
                <Td align="right" numero mute>
                  {i + 1}
                </Td>
                <Td>
                  <span className="font-medium text-text">{r.nombre}</span>
                  {r.marcaNombre && <span className="text-text-3"> · {r.marcaNombre}</span>}
                </Td>
                <Td mute>{r.presentacion ? presentacionLabel(r.presentacion) : "—"}</Td>
                <Td align="right" numero>
                  {r.unidades}
                </Td>
                <Td align="right" numero>
                  {formatoMoneda.format(r.importe)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Tabla>
      )}
    </Card>
  );
}
