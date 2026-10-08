"use client";

import { useMemo, useState, useTransition } from "react";
import { guardarPromocion, type PromocionItemInput } from "../actions";
import { SkuPicker, type SkuCatalogo } from "../../compras/_components/sku-picker";
import { presentacionLabel } from "../../productos/_lib/presentacion";
import { formatoMoneda } from "../_lib/formato";
import type { PromocionRow, Sucursal } from "./promociones-panel";

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";
const modoBtnClass = (activo: boolean) =>
  `rounded-[6px] border px-[10px] py-[5px] text-[12.5px] font-medium ${
    activo ? "border-moe bg-moe-soft text-moe" : "border-border bg-bg text-text-2 hover:bg-bg-2"
  }`;

type Fila = { skuId: string };

// costo_actual no viene en SkuCatalogo (compras no lo necesita): esta
// pantalla solo se muestra a quien ya puede ver costos (ve_costos()), asi
// que se extiende para poder avisar si un precio queda por debajo.
export type PromocionSkuOpcion = SkuCatalogo & { costo_actual: number | null };

export function PromocionForm({
  sucursales,
  skus,
  promocion,
  onClose,
}: {
  sucursales: Sucursal[];
  skus: PromocionSkuOpcion[];
  promocion: PromocionRow | null;
  onClose: () => void;
}) {
  const esEdicion = promocion !== null;
  const skuPorId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const [nombre, setNombre] = useState(promocion?.nombre ?? "");
  const [tipo, setTipo] = useState<"combo" | "cantidad">(promocion?.tipo ?? "combo");
  const [sucursalId, setSucursalId] = useState(promocion?.sucursal_id ?? "");
  const [vigenteDesde, setVigenteDesde] = useState(promocion?.vigente_desde ?? "");
  const [vigenteHasta, setVigenteHasta] = useState(promocion?.vigente_hasta ?? "");
  // Sin fecha de corte = la promo queda activa hasta que la des de baja a
  // mano. El modelo siempre lo permitió (vigente_hasta null), pero el
  // formulario mostraba un campo vacío y no se entendía (usuario 2026-10-08).
  const [sinFechaLimite, setSinFechaLimite] = useState(promocion?.vigente_hasta == null);
  const [activo, setActivo] = useState(promocion?.activo ?? true);

  // Combo: solo qué productos lo arman. El precio ya no va por producto --
  // se carga el total de la promo más abajo, uno por sucursal.
  const [filasCombo, setFilasCombo] = useState<Fila[]>(
    promocion?.tipo === "combo" ? promocion.items.map((i) => ({ skuId: i.sku_id })) : [],
  );

  // El total que paga el cliente, por sucursal. Olavarría y Laprida no
  // manejan los mismos precios, así que una promo que corre en las dos
  // lleva dos totales.
  const [precios, setPrecios] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const s of sucursales) {
      const fila = promocion?.precios?.find((p) => p.sucursal_id === s.id);
      inicial[s.id] = fila ? String(fila.precio_total) : "";
    }
    return inicial;
  });

  // Cantidad: un solo SKU + cuantas unidades entran en el grupo + precio
  // del grupo completo (ej. 2x $20.000 -> cantidadRequerida=2).
  const [skuCantidadId, setSkuCantidadId] = useState(
    promocion?.tipo === "cantidad" ? (promocion.items[0]?.sku_id ?? "") : "",
  );
  const [cantidadRequerida, setCantidadRequerida] = useState(
    promocion?.tipo === "cantidad" ? String(promocion.items[0]?.cantidad_requerida ?? 2) : "2",
  );

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const excluirIdsCombo = useMemo(() => new Set(filasCombo.map((f) => f.skuId)), [filasCombo]);

  function agregarSkuCombo(sku: SkuCatalogo) {
    setFilasCombo((prev) => [...prev, { skuId: sku.id }]);
  }

  // Las sucursales donde corre la promo: todas, o la única elegida.
  const sucursalesConPrecio = sucursalId ? sucursales.filter((s) => s.id === sucursalId) : sucursales;

  function quitarFilaCombo(index: number) {
    setFilasCombo((prev) => prev.filter((_, i) => i !== index));
  }

  function advertenciaBajoCosto(skuId: string, precioUnitario: number): string | null {
    const sku = skuPorId.get(skuId);
    if (!sku || sku.costo_actual == null) return null;
    if (precioUnitario < sku.costo_actual) {
      return `Queda por debajo del costo (${formatoMoneda.format(sku.costo_actual)}).`;
    }
    return null;
  }

  function validar(): string | null {
    if (!nombre.trim()) return "Ingresá el nombre de la promoción.";
    if (!sinFechaLimite && vigenteDesde && vigenteHasta && vigenteDesde > vigenteHasta)
      return "La promoción no puede terminar antes de empezar.";
    if (!sinFechaLimite && !vigenteHasta) return "Elegí hasta qué día corre, o marcá que no tiene fecha límite.";

    if (tipo === "combo") {
      if (filasCombo.length < 2) return "Un combo necesita al menos 2 SKU distintos.";
    } else {
      if (!skuCantidadId) return "Elegí el SKU de la promoción.";
      const cantidad = Number(cantidadRequerida);
      if (!Number.isInteger(cantidad) || cantidad < 2) return "La cantidad tiene que ser un entero de 2 o más (2x, 3x...).";
    }

    // Sin precio en ninguna sucursal, la promo no corre en ningún lado.
    const cargados = sucursalesConPrecio.filter((s) => (precios[s.id] ?? "").trim() !== "");
    if (cargados.length === 0)
      return sucursalesConPrecio.length === 1
        ? "Cargá el total de la promoción."
        : "Cargá el total en al menos una sucursal.";

    for (const s of cargados) {
      const monto = Number(precios[s.id]);
      if (Number.isNaN(monto) || monto < 0)
        return `El total en ${s.nombre} tiene que ser un número mayor o igual a cero.`;
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

    const items: PromocionItemInput[] =
      tipo === "combo"
        ? filasCombo.map((f) => ({ skuId: f.skuId, cantidadRequerida: 1 }))
        : [{ skuId: skuCantidadId, cantidadRequerida: Number(cantidadRequerida) }];

    // Solo las sucursales con total cargado: dejar una vacía es la forma de
    // decir "esta promo no corre ahí".
    const preciosParaGuardar = sucursalesConPrecio
      .filter((s) => (precios[s.id] ?? "").trim() !== "")
      .map((s) => ({ sucursalId: s.id, precioTotal: Number(precios[s.id]) }));

    startTransition(async () => {
      const resultado = await guardarPromocion({
        id: promocion?.id ?? null,
        nombre: nombre.trim(),
        tipo,
        sucursalId: sucursalId || null,
        vigenteDesde: vigenteDesde || null,
        vigenteHasta: sinFechaLimite ? null : vigenteHasta || null,
        activo,
        items,
        precios: preciosParaGuardar,
      });
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onClose();
    });
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-[560px] overflow-y-auto rounded-card border border-border bg-bg p-5">
        <h2 className="mb-4 text-[14px] font-semibold text-text">
          {esEdicion ? "Editar promoción" : "Nueva promoción"}
        </h2>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass}>Nombre *</label>
            <input
              type="text"
              className={inputClass}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Fernet Branca + Coca-Cola"
            />
          </div>

          <div>
            <label className={labelClass}>Tipo *</label>
            <div className="flex gap-2">
              <button
                type="button"
                className={modoBtnClass(tipo === "combo")}
                onClick={() => setTipo("combo")}
                disabled={esEdicion}
              >
                Combo (2 o más SKU distintos)
              </button>
              <button
                type="button"
                className={modoBtnClass(tipo === "cantidad")}
                onClick={() => setTipo("cantidad")}
                disabled={esEdicion}
              >
                Cantidad (2x, 3x…)
              </button>
            </div>
            {esEdicion && (
              <p className="mt-1 text-[11.5px] text-text-3">
                El tipo no se puede cambiar una vez creada — si hace falta, creá una promoción nueva.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Sucursal</label>
              <select className={inputClass} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                <option value="">Ambas sucursales</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Activa</label>
              <label className="flex h-[32px] items-center gap-2 text-[13px] text-text">
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
                {activo ? "Sí" : "No"}
              </label>
            </div>
          </div>

          <div>
            <label className={labelClass}>¿Hasta cuándo corre?</label>
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                className={modoBtnClass(sinFechaLimite)}
                onClick={() => setSinFechaLimite(true)}
              >
                Activa sin fecha límite
              </button>
              <button
                type="button"
                className={modoBtnClass(!sinFechaLimite)}
                onClick={() => setSinFechaLimite(false)}
              >
                Hasta una fecha
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Arranca</label>
                <input
                  type="date"
                  className={inputClass}
                  value={vigenteDesde}
                  onChange={(e) => setVigenteDesde(e.target.value)}
                />
                <p className="mt-[3px] text-[11.5px] text-text-3">Vacío = ya está corriendo.</p>
              </div>
              {!sinFechaLimite && (
                <div>
                  <label className={labelClass}>Último día *</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={vigenteHasta}
                    onChange={(e) => setVigenteHasta(e.target.value)}
                  />
                  <p className="mt-[3px] text-[11.5px] text-text-3">Ese día todavía vale.</p>
                </div>
              )}
            </div>

            {sinFechaLimite && (
              <p className="mt-2 text-[11.5px] text-text-3">
                Va a seguir aplicándose hasta que la des de baja a mano desde esta pantalla.
              </p>
            )}
          </div>

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-[12px] font-medium text-text-2">
              {tipo === "combo" ? "Productos que arman el combo" : "SKU de la promoción"}
            </p>

            {tipo === "combo" ? (
              <div className="space-y-2">
                {filasCombo.map((f, index) => {
                  const sku = skuPorId.get(f.skuId);
                  return (
                    <div key={f.skuId} className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <span className="truncate text-[13px] text-text">
                        {sku?.producto?.nombre}
                        {sku && <span className="text-text-3"> · {sku.producto?.marca?.nombre} — {presentacionLabel(sku)}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => quitarFilaCombo(index)}
                        className="rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[12.5px] text-text-3 hover:bg-bg-2 hover:text-err"
                      >
                        Quitar
                      </button>
                    </div>
                  );
                })}
                <SkuPicker skus={skus} excluirIds={excluirIdsCombo} onSelect={agregarSkuCombo} />
              </div>
            ) : (
              <div className="space-y-2">
                {skuCantidadId ? (
                  <div className="flex items-center justify-between rounded-[6px] border border-border bg-bg-2 px-[10px] py-[7px] text-[13px]">
                    <span>
                      {(() => {
                        const sku = skuPorId.get(skuCantidadId);
                        return sku ? (
                          <>
                            <span className="font-medium text-text">{sku.producto?.nombre}</span>
                            <span className="text-text-3"> · {sku.producto?.marca?.nombre} — {presentacionLabel(sku)}</span>
                          </>
                        ) : null;
                      })()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSkuCantidadId("")}
                      className="text-[12px] text-text-3 hover:text-err"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <SkuPicker skus={skus} excluirIds={new Set()} onSelect={(s) => setSkuCantidadId(s.id)} />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Cantidad (2x, 3x…) *</label>
                    <input
                      type="number"
                      min={2}
                      className={inputClass}
                      value={cantidadRequerida}
                      onChange={(e) => setCantidadRequerida(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ============ Total de la promo, por sucursal ============ */}
          <div className="border-t border-border pt-3">
            <p className="mb-1 text-[12px] font-medium text-text-2">
              {tipo === "combo"
                ? "Cuánto sale el combo completo"
                : "Cuánto sale llevar el grupo completo"}
            </p>
            <p className="mb-2 text-[11.5px] text-text-3">
              Es el total que paga el cliente. El ticket muestra el nombre de la promoción y este
              número.
              {sucursalesConPrecio.length > 1 &&
                " Dejá vacía una sucursal si la promo no corre ahí."}
            </p>

            <div className="space-y-2">
              {sucursalesConPrecio.map((suc) => {
                const valor = precios[suc.id] ?? "";
                const monto = Number(valor);
                const unidades =
                  tipo === "combo" ? filasCombo.length : Number(cantidadRequerida) || 0;
                const advertencia =
                  valor.trim() !== "" && !Number.isNaN(monto) && unidades > 0 && tipo === "cantidad"
                    ? advertenciaBajoCosto(skuCantidadId, monto / unidades)
                    : null;

                return (
                  <div key={suc.id}>
                    <div className="grid grid-cols-[1fr_160px] items-center gap-2">
                      <span className="text-[13px] text-text">{suc.nombre}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={`${inputClass} tabular-nums`}
                        value={valor}
                        onChange={(e) => setPrecios({ ...precios, [suc.id]: e.target.value })}
                        placeholder="Total"
                      />
                    </div>
                    {advertencia && <p className="mt-1 text-[11.5px] text-warn">{advertencia}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[11.5px] text-text-3">
            Recordá: las promociones solo se aplican pagando en efectivo (billete en mano).
          </p>
        </div>

        {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
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
            {pending ? "Guardando…" : "Guardar promoción"}
          </button>
        </div>
      </div>
    </div>
  );
}
