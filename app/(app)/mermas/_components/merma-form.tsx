"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { SkuPicker, type SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import {
  fechaVencimientoAIso,
  fechaVencimientoDesdeIso,
} from "@/app/(app)/compras/_lib/vencimiento";
import { datosSkuParaMerma, registrarMermas } from "../actions";
import { ModalVencimiento } from "./modal-vencimiento";
import { MOTIVOS_MERMA, MOTIVO_MERMA_LABEL, type MotivoMerma } from "../_lib/motivos";

type Sucursal = { id: string; nombre: string };
type Empleado = { id: string; nombre: string; sucursal_id: string };

// Un producto de la carga. El mismo SKU puede aparecer dos veces a propósito
// (se rompió una y se venció otra son dos mermas distintas, con motivos
// distintos); lo único que se evita es duplicarlo cuando el renglón anterior
// todavía está vacío, para que un doble escaneo no deje una fila en blanco.
type Item = {
  sku: SkuCatalogo;
  stock: number | null;
  cantidad: string;
  motivo: MotivoMerma | "";
  // dd/mm/aaaa. Solo se usa cuando el motivo es "vencido".
  vencimiento: string;
  vencimientoUltimoLote: string | null;
  detalle: string;
};

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[7px] text-[14px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

function nombreSku(sku: SkuCatalogo) {
  return sku.producto?.nombre ?? sku.codigo_interno;
}

export function MermaForm({
  sucursales,
  empleados,
  skus,
}: {
  sucursales: Sucursal[];
  empleados: Empleado[];
  skus: SkuCatalogo[];
}) {
  const router = useRouter();
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [empleadoId, setEmpleadoId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  // Índice del producto cuyo vencimiento se está preguntando (null = cerrado).
  const [modalVencimiento, setModalVencimiento] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function actualizar(index: number, cambios: Partial<Item>) {
    setItems((actuales) =>
      actuales.map((item, i) => (i === index ? { ...item, ...cambios } : item)),
    );
  }

  async function agregarSku(elegido: SkuCatalogo) {
    setError(null);
    setOk(null);

    // Doble escaneo del mismo producto sin haber cargado nada: no agrega un
    // renglón nuevo, ya está ahí esperando que lo completen.
    const vacioDelMismoSku = items.findIndex(
      (item) => item.sku.id === elegido.id && item.cantidad === "" && item.motivo === "",
    );
    if (vacioDelMismoSku !== -1) return;

    setItems((actuales) => [
      ...actuales,
      {
        sku: elegido,
        stock: null,
        cantidad: "",
        motivo: "",
        vencimiento: "",
        vencimientoUltimoLote: null,
        detalle: "",
      },
    ]);

    const resultado = await datosSkuParaMerma(elegido.id, sucursalId);
    if ("error" in resultado) {
      setError(resultado.error);
      return;
    }
    // Por id y no por índice: entre el pedido y la respuesta pueden haberse
    // agregado o quitado otros productos.
    setItems((actuales) =>
      actuales.map((item) =>
        item.sku.id === elegido.id && item.stock === null
          ? {
              ...item,
              stock: resultado.stock,
              vencimientoUltimoLote: resultado.vencimientoUltimoLote,
            }
          : item,
      ),
    );
  }

  function quitar(index: number) {
    setItems((actuales) => actuales.filter((_, i) => i !== index));
    setError(null);
  }

  // El modal se abre al elegir "vencido": con el producto en la mano, no al
  // final del formulario de memoria. Si lo cancela, el motivo de ese producto
  // vuelve a quedar sin elegir -- no se puede guardar un "vencido" sin fecha.
  function elegirMotivo(index: number, m: MotivoMerma) {
    setError(null);
    if (m === "vencido") {
      actualizar(index, { motivo: m });
      setModalVencimiento(index);
    } else {
      actualizar(index, { motivo: m, vencimiento: "" });
    }
  }

  function limpiar() {
    setItems([]);
    setEmpleadoId("");
    setModalVencimiento(null);
    setError(null);
  }

  function guardar() {
    if (items.length === 0) return;

    if (!empleadoId) {
      setError("Elegí quién la registra.");
      return;
    }

    for (const [i, item] of items.entries()) {
      const nombre = nombreSku(item.sku);
      const cantidadNum = Number(item.cantidad);
      if (item.cantidad === "" || !Number.isInteger(cantidadNum) || cantidadNum <= 0) {
        setError(`${nombre}: escribí cuántas unidades se perdieron.`);
        return;
      }
      if (!item.motivo) {
        setError(`${nombre}: elegí un motivo.`);
        return;
      }
      if (item.motivo === "vencido" && !item.vencimiento) {
        setError(`${nombre}: indicá cuándo vencía.`);
        setModalVencimiento(i);
        return;
      }
      if (item.motivo === "otro" && !item.detalle.trim()) {
        setError(`${nombre}: contá qué pasó.`);
        return;
      }
    }

    setError(null);
    startTransition(async () => {
      const resultado = await registrarMermas({
        sucursal_id: sucursalId,
        empleado_id: empleadoId,
        items: items.map((item) => ({
          sku_id: item.sku.id,
          nombre: nombreSku(item.sku),
          cantidad: Number(item.cantidad),
          motivo: item.motivo as MotivoMerma,
          detalle: item.detalle.trim() || null,
          fecha_vencimiento:
            item.motivo === "vencido" ? fechaVencimientoAIso(item.vencimiento) : null,
        })),
      });

      if ("error" in resultado) {
        setError(resultado.error);
        // Lo que sí entró ya es un movimiento de stock hecho: se saca de la
        // lista para que no se registre dos veces al reintentar. Queda en
        // pantalla justo lo que falta.
        if (resultado.registradas > 0) {
          setItems((actuales) => actuales.slice(resultado.registradas));
          router.refresh();
        }
        return;
      }

      const primero = items[0];
      setOk(
        resultado.registradas === 1
          ? `Registrado: ${Number(primero.cantidad)} × ${nombreSku(primero.sku)}. El stock ya quedó descontado.`
          : `Registradas ${resultado.registradas} mermas. El stock ya quedó descontado.`,
      );
      limpiar();
      router.refresh();
    });
  }

  // Cada mostrador ve solo a su gente: la función además lo valida contra
  // la base, para que desde Laprida no se pueda cargar a nombre de alguien
  // de Olavarría.
  const empleadosDeLaSucursal = empleados.filter((e) => e.sucursal_id === sucursalId);

  const itemDelModal = modalVencimiento !== null ? items[modalVencimiento] : undefined;

  return (
    <div className="rounded-card border border-border bg-bg p-5">
      <h1 className="text-[15px] font-semibold text-text">Registrar merma</h1>
      <p className="mt-[3px] text-[12.5px] leading-[1.5] text-text-3">
        Lo que se rompió, se venció o se consumió adentro del local. Anotalo en el momento: lo que
        queda sin explicar en el próximo inventario es lo que realmente falta.
      </p>

      {ok && (
        <p className="mt-3 rounded-[6px] border border-ok/30 bg-ok-bg px-[12px] py-[8px] text-[12.5px] text-ok">
          {ok}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {sucursales.length > 1 && (
          <div>
            <label className={labelClass}>Sucursal</label>
            <select
              className={inputClass}
              value={sucursalId}
              onChange={(e) => {
                setSucursalId(e.target.value);
                limpiar();
              }}
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={labelClass}>¿Quién la registra? *</label>
          <select
            className={inputClass}
            value={empleadoId}
            onChange={(e) => {
              setEmpleadoId(e.target.value);
              setError(null);
            }}
          >
            <option value="">Elegir…</option>
            {empleadosDeLaSucursal.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
          {empleadosDeLaSucursal.length === 0 && (
            <p className="mt-[3px] text-[11.5px] text-warn">
              No hay empleados cargados en esta sucursal.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className={labelClass}>Agregar producto</label>
        <SkuPicker skus={skus} excluirIds={new Set()} onSelect={agregarSku} />
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-[6px] border border-dashed border-border px-[12px] py-[14px] text-center text-[12.5px] text-text-3">
          Buscá o escaneá lo que se perdió. Podés agregar todos los productos que quieras y
          registrarlos juntos.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {items.map((item, i) => {
            // Avisa, no bloquea: que el stock quede negativo es información
            // real (el conteo estaba mal), no algo para esconder.
            const quedaNegativo =
              item.stock !== null && item.cantidad !== "" && Number(item.cantidad) > item.stock;

            return (
              <div
                key={`${item.sku.id}-${i}`}
                className="rounded-[6px] border border-border bg-bg-2/40 p-[12px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-semibold text-text">{nombreSku(item.sku)}</p>
                    <p className="text-[12.5px] text-text-3">
                      {[item.sku.producto?.marca?.nombre, presentacionLabel(item.sku)]
                        .filter(Boolean)
                        .join(" — ")}
                      {item.stock !== null && ` · quedan ${item.stock}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => quitar(i)}
                    className="shrink-0 text-[12px] text-text-3 hover:text-err"
                  >
                    Quitar
                  </button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <div>
                    <label className={labelClass}>Cantidad *</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      autoFocus={i === items.length - 1}
                      className={`${inputClass} text-right tabular-nums`}
                      value={item.cantidad}
                      onChange={(e) => actualizar(i, { cantidad: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>¿Qué pasó? *</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {MOTIVOS_MERMA.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => elegirMotivo(i, m)}
                          className={`rounded-[6px] border px-[8px] py-[7px] text-[12.5px] font-medium ${
                            item.motivo === m
                              ? "border-moe bg-moe-soft text-moe"
                              : "border-border bg-bg text-text-2 hover:bg-[#FAFAFB]"
                          }`}
                        >
                          {MOTIVO_MERMA_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {item.motivo === "vencido" && item.vencimiento && (
                  <p className="mt-2 text-[12.5px] text-text-2">
                    Vencía el{" "}
                    <b className="font-medium tabular-nums text-text">{item.vencimiento}</b>{" "}
                    <button
                      type="button"
                      onClick={() => setModalVencimiento(i)}
                      className="font-medium text-moe hover:underline"
                    >
                      cambiar
                    </button>
                  </p>
                )}

                <div className="mt-3">
                  <label className={labelClass}>
                    Detalle {item.motivo === "otro" ? "*" : "(opcional)"}
                  </label>
                  <input
                    className={inputClass}
                    placeholder="Ej.: se cayó una caja al bajarla del estante"
                    value={item.detalle}
                    onChange={(e) => actualizar(i, { detalle: e.target.value })}
                  />
                </div>

                {quedaNegativo && (
                  <p className="mt-3 rounded-[6px] border border-warn/40 bg-warn-bg px-[12px] py-[8px] text-[12.5px] text-warn">
                    Estás registrando más unidades de las que figuran en el sistema. Se puede
                    guardar igual, pero anotalo: quiere decir que el stock de este producto ya
                    estaba mal.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

      {items.length > 0 && (
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={limpiar}
            className="text-[12.5px] text-text-3 hover:text-text"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={pending}
            className="rounded-[6px] bg-moe px-[14px] py-[8px] text-[13.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
          >
            {pending
              ? "Registrando…"
              : items.length === 1
                ? "Registrar merma"
                : `Registrar ${items.length} mermas`}
          </button>
        </div>
      )}

      {modalVencimiento !== null && itemDelModal && (
        <ModalVencimiento
          producto={`${nombreSku(itemDelModal.sku)} — ${presentacionLabel(itemDelModal.sku)}`}
          valorInicial={
            itemDelModal.vencimiento ||
            fechaVencimientoDesdeIso(itemDelModal.vencimientoUltimoLote)
          }
          onConfirmar={(fecha) => {
            actualizar(modalVencimiento, { vencimiento: fecha });
            setModalVencimiento(null);
          }}
          onCancelar={() => {
            if (!itemDelModal.vencimiento) actualizar(modalVencimiento, { motivo: "" });
            setModalVencimiento(null);
          }}
        />
      )}
    </div>
  );
}
