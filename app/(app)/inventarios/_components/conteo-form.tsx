"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  presentacionLabel,
  type SkuPresentacion,
} from "@/app/(app)/productos/_components/productos-table";
import { formatoFechaHora } from "../../compras/_lib/formato";
import { confirmarInventario, guardarConteo } from "../actions";
import {
  EstadoInventarioBadge,
  MOTIVOS_INVENTARIO,
  MOTIVO_INVENTARIO_LABEL,
  TIPO_INVENTARIO_LABEL,
  type EstadoInventario,
  type MotivoInventario,
  type TipoInventario,
} from "./estado-inventario-badge";

export type ItemConteo = {
  id: string;
  sku_id: string;
  stock_sistema: number;
  stock_contado: number | null;
  diferencia: number | null;
  motivo: MotivoInventario | null;
  sku: SkuPresentacion & {
    codigo_interno: string;
    producto: {
      nombre: string;
      marca: { nombre: string } | null;
      categoria: { nombre: string } | null;
    } | null;
  };
};

type InventarioHeader = {
  id: string;
  tipo: TipoInventario;
  estado: EstadoInventario;
  fecha_inicio: string;
  fecha_fin: string | null;
  sucursal_nombre: string;
  categoria_nombre: string | null;
};

export function ConteoForm({
  inventario,
  items,
  puedeOperar,
}: {
  inventario: InventarioHeader;
  items: ItemConteo[];
  puedeOperar: boolean;
}) {
  const router = useRouter();
  const editable = inventario.estado === "abierto" && puedeOperar;

  const [contados, setContados] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.sku_id, i.stock_contado?.toString() ?? ""])),
  );
  const [motivos, setMotivos] = useState<Record<string, MotivoInventario | "">>(
    Object.fromEntries(items.map((i) => [i.sku_id, i.motivo ?? ""])),
  );
  const [guardando, setGuardando] = useState<Record<string, boolean>>({});
  const [erroresFila, setErroresFila] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState("");
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const categorias = useMemo(() => {
    const nombres = new Set<string>();
    for (const i of items) {
      if (i.sku.producto?.categoria?.nombre) nombres.add(i.sku.producto.categoria.nombre);
    }
    return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
  }, [items]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (categoria && i.sku.producto?.categoria?.nombre !== categoria) return false;
      if (!q) return true;
      const producto = i.sku.producto?.nombre.toLowerCase() ?? "";
      const marca = i.sku.producto?.marca?.nombre.toLowerCase() ?? "";
      return producto.includes(q) || marca.includes(q) || i.sku.codigo_interno.toLowerCase().includes(q);
    });
  }, [items, query, categoria]);

  function difiere(skuId: string, sistema: number) {
    const c = contados[skuId];
    return c !== "" && Number(c) !== sistema;
  }

  const contadosCount = items.filter((i) => contados[i.sku_id] !== "").length;
  const conDiferenciaCount = items.filter((i) => difiere(i.sku_id, i.stock_sistema)).length;
  const sinMotivoCount = items.filter(
    (i) => difiere(i.sku_id, i.stock_sistema) && !motivos[i.sku_id],
  ).length;
  const puedeConfirmar =
    editable && contadosCount === items.length && sinMotivoCount === 0 && !pending;

  async function guardarFila(skuId: string, stockContado: number, motivo: string) {
    setGuardando((prev) => ({ ...prev, [skuId]: true }));
    const resultado = await guardarConteo(inventario.id, [
      { sku_id: skuId, stock_contado: stockContado, motivo: motivo || null },
    ]);
    setGuardando((prev) => ({ ...prev, [skuId]: false }));
    setErroresFila((prev) => ({ ...prev, [skuId]: "error" in resultado ? resultado.error : null }));
  }

  function commit(skuId: string, valorStr: string, sistema: number) {
    setContados((prev) => ({ ...prev, [skuId]: valorStr }));
    if (valorStr === "") return;
    const valor = Number(valorStr);
    if (!Number.isInteger(valor) || valor < 0) {
      setErroresFila((prev) => ({ ...prev, [skuId]: "Tiene que ser un entero mayor o igual a cero." }));
      return;
    }
    const motivoActual = valor !== sistema ? motivos[skuId] || "" : "";
    if (valor === sistema && motivos[skuId]) {
      setMotivos((prev) => ({ ...prev, [skuId]: "" }));
    }
    void guardarFila(skuId, valor, motivoActual);
  }

  function paso(skuId: string, sistema: number, delta: number) {
    const vacio = contados[skuId] === "";
    // Restar desde vacío no cuenta como "conté 0": no hace nada. Sumar desde
    // vacío sí es una cuenta real (arranca en 1, no en 0+1 registrado a ciegas).
    if (vacio && delta < 0) return;
    const actual = vacio ? 0 : Number(contados[skuId]);
    const nuevo = Math.max(0, actual + delta);
    commit(skuId, String(nuevo), sistema);
  }

  function cambiarMotivo(skuId: string, sistema: number, motivo: MotivoInventario | "") {
    setMotivos((prev) => ({ ...prev, [skuId]: motivo }));
    const c = contados[skuId];
    if (c === "") return;
    const valor = Number(c);
    if (Number.isInteger(valor) && valor >= 0) {
      void guardarFila(skuId, valor, valor !== sistema ? motivo : "");
    }
  }

  function confirmar() {
    setErrorGeneral(null);
    startTransition(async () => {
      const resultado = await confirmarInventario(inventario.id);
      if ("error" in resultado) {
        setErrorGeneral(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 pb-[76px]">
      <div className="rounded-card border border-border bg-bg p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">
              {TIPO_INVENTARIO_LABEL[inventario.tipo]}
              {inventario.categoria_nombre ? ` · ${inventario.categoria_nombre}` : ""}
            </h2>
            <p className="mt-[2px] text-[12.5px] text-text-3">
              {inventario.sucursal_nombre} · Iniciado{" "}
              {formatoFechaHora.format(new Date(inventario.fecha_inicio))}
              {inventario.fecha_fin
                ? ` · Cerrado ${formatoFechaHora.format(new Date(inventario.fecha_fin))}`
                : ""}
            </p>
          </div>
          <EstadoInventarioBadge estado={inventario.estado} />
        </div>
      </div>

      {!puedeOperar && (
        <div className="rounded-card border border-border bg-bg p-4 text-[12.5px] text-text-2">
          Solo podés ver este inventario, no tenés permiso para cargar el conteo de esta sucursal.
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-card border border-border bg-bg p-3 sm:flex-row">
        {categorias.length > 1 && (
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-[6px] border border-border bg-bg-2 px-[10px] py-[7px] text-[13.5px] text-text outline-none focus:border-moe"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por producto, marca o código…"
          className="flex-1 rounded-[6px] border border-border bg-bg-2 px-[10px] py-[7px] text-[13.5px] text-text outline-none focus:border-moe"
        />
      </div>

      <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto">
        {filtrados.length === 0 && (
          <div className="rounded-card border border-border bg-bg px-[14px] py-[20px] text-center text-[12.5px] text-text-3">
            No encontramos productos con esa búsqueda.
          </div>
        )}
        {filtrados.map((item) => {
          const contado = contados[item.sku_id] ?? "";
          const yaContado = contado !== "";
          const tieneDiferencia = difiere(item.sku_id, item.stock_sistema);
          const faltaMotivo = tieneDiferencia && !motivos[item.sku_id];
          const errorFila = erroresFila[item.sku_id];

          return (
            <div
              key={item.id}
              className={`rounded-card border bg-bg p-[12px] ${
                faltaMotivo
                  ? "border-warn"
                  : yaContado
                    ? "border-border"
                    : "border-border border-dashed"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-text">
                    {item.sku.producto?.nombre}
                  </p>
                  <p className="text-[11.5px] text-text-3">
                    {item.sku.producto?.marca?.nombre} — {presentacionLabel(item.sku)}
                  </p>
                  <p className="mt-[2px] text-[12px] text-text-2">
                    Sistema: <span className="font-medium tabular-nums">{item.stock_sistema}</span>
                  </p>
                </div>

                {editable ? (
                  <div className="flex shrink-0 items-center gap-[6px]">
                    <button
                      type="button"
                      onClick={() => paso(item.sku_id, item.stock_sistema, -1)}
                      disabled={!yaContado}
                      className="grid h-[34px] w-[34px] place-items-center rounded-[6px] border border-border text-[16px] font-medium text-text-2 hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                      aria-label="Restar una unidad"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={contado}
                      onChange={(e) =>
                        setContados((prev) => ({ ...prev, [item.sku_id]: e.target.value }))
                      }
                      onBlur={(e) => commit(item.sku_id, e.target.value.trim(), item.stock_sistema)}
                      className="w-[64px] rounded-[6px] border border-border bg-bg px-[6px] py-[6px] text-center text-[15px] font-medium tabular-nums outline-none focus:border-moe"
                    />
                    <button
                      type="button"
                      onClick={() => paso(item.sku_id, item.stock_sistema, 1)}
                      className="grid h-[34px] w-[34px] place-items-center rounded-[6px] border border-border text-[16px] font-medium text-text-2 hover:bg-bg-2"
                      aria-label="Sumar una unidad"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <p className="shrink-0 text-[15px] font-medium tabular-nums text-text">
                    {item.stock_contado ?? "—"}
                  </p>
                )}
              </div>

              {tieneDiferencia && (
                <div className="mt-[8px] flex items-center gap-[8px]">
                  <span className="whitespace-nowrap text-[12px] font-medium text-warn">
                    Diferencia: {Number(contado) - item.stock_sistema > 0 ? "+" : ""}
                    {Number(contado) - item.stock_sistema}
                  </span>
                  {editable ? (
                    <select
                      value={motivos[item.sku_id] ?? ""}
                      onChange={(e) =>
                        cambiarMotivo(
                          item.sku_id,
                          item.stock_sistema,
                          e.target.value as MotivoInventario | "",
                        )
                      }
                      className={`flex-1 rounded-[6px] border bg-bg px-[8px] py-[5px] text-[12.5px] text-text outline-none focus:border-moe ${
                        faltaMotivo ? "border-warn" : "border-border"
                      }`}
                    >
                      <option value="">Motivo (obligatorio)…</option>
                      {MOTIVOS_INVENTARIO.map((m) => (
                        <option key={m} value={m}>
                          {MOTIVO_INVENTARIO_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[12.5px] text-text-2">
                      {item.motivo ? MOTIVO_INVENTARIO_LABEL[item.motivo] : "—"}
                    </span>
                  )}
                </div>
              )}

              {errorFila && <p className="mt-[6px] text-[12px] text-err">{errorFila}</p>}
              {guardando[item.sku_id] && (
                <p className="mt-[6px] text-[11.5px] text-text-3">Guardando…</p>
              )}
            </div>
          );
        })}
      </div>

      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg px-4 py-3">
          <div className="mx-auto flex max-w-[900px] flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] text-text-2">
              {contadosCount} de {items.length} contados
              {conDiferenciaCount > 0 && (
                <>
                  {" · "}
                  <span className={sinMotivoCount > 0 ? "font-medium text-warn" : "text-text-2"}>
                    {conDiferenciaCount} con diferencia
                    {sinMotivoCount > 0 ? ` (${sinMotivoCount} sin motivo)` : ""}
                  </span>
                </>
              )}
            </span>
            <div className="flex items-center gap-3">
              {errorGeneral && <p className="text-[12.5px] text-err">{errorGeneral}</p>}
              <button
                type="button"
                onClick={confirmar}
                disabled={!puedeConfirmar}
                className="rounded-[6px] bg-moe px-[14px] py-[8px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? "Confirmando…" : "Confirmar inventario"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
