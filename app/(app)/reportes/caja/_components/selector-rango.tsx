"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { diaAnterior, lunesDe } from "../_lib/dia";

// "Cierre por fechas" (pedido del usuario 2026-11-09): un modal para elegir
// desde qué día hasta qué día cerrar la caja -- de lunes a lunes, una semana
// o cualquier tramo -- y ver todos los medios de pago de ese período. Los dos
// días son inclusivos. El rango viaja en la URL (?desde=&hasta=) como el día
// y el período, así que se puede guardar el link.
export function SelectorRango({
  base,
  hoy,
  sucursal,
  desde: desdeActual,
  hasta: hastaActual,
}: {
  base: string;
  hoy: string;
  // Sucursal elegida: se conserva al cambiar de rango.
  sucursal?: string;
  // Rango que se está mirando (null si no hay ninguno).
  desde: string | null;
  hasta: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState(desdeActual ?? lunesDe(hoy));
  const [hasta, setHasta] = useState(hastaActual ?? hoy);
  const [error, setError] = useState<string | null>(null);

  const hayRango = desdeActual != null && hastaActual != null;

  function abrir() {
    setDesde(desdeActual ?? lunesDe(hoy));
    setHasta(hastaActual ?? hoy);
    setError(null);
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
  }

  function aplicar(d: string, h: string) {
    if (!d || !h) {
      setError("Elegí las dos fechas.");
      return;
    }
    if (d > h) {
      setError('La fecha "desde" no puede ser posterior a "hasta".');
      return;
    }
    if (h > hoy) {
      setError("No hay caja del futuro: la última fecha posible es hoy.");
      return;
    }
    const sufijo = sucursal ? `&sucursal=${sucursal}` : "";
    router.push(`${base}?desde=${d}&hasta=${h}${sufijo}`);
    setAbierto(false);
  }

  // Atajos: la semana del negocio es de lunes a domingo.
  const lunesEsta = lunesDe(hoy);
  const domingoPasado = diaAnterior(lunesEsta);
  const lunesPasado = lunesDe(domingoPasado);

  const atajoClass =
    "rounded-[6px] border border-border bg-bg px-[10px] py-[5px] text-[12.5px] font-medium text-text-2 hover:bg-bg-2";

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        title="Cerrar la caja de una semana o de las fechas que elijas"
        className={`rounded-[6px] border px-[10px] py-[4px] text-[12px] font-medium ${
          hayRango
            ? "border-moe bg-moe-soft text-moe"
            : "border-border bg-bg text-text-2 hover:bg-bg-2"
        }`}
      >
        Cierre por fechas
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={cerrar}
          onKeyDown={(e) => {
            if (e.key === "Escape") cerrar();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cierre de caja por fechas"
            className="w-[400px] max-w-full rounded-card border border-border bg-bg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[15.5px] font-semibold text-text">Cierre de caja por fechas</h2>
            <p className="mb-4 mt-[2px] text-[12.5px] text-text-3">
              Elegí desde qué día hasta qué día. Los dos días entran. Vas a ver la caja con todos
              los medios de pago de ese período.
            </p>

            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" className={atajoClass} onClick={() => aplicar(lunesEsta, hoy)}>
                Esta semana
              </button>
              <button
                type="button"
                className={atajoClass}
                onClick={() => aplicar(lunesPasado, domingoPasado)}
              >
                Semana pasada
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-[3px] text-[11.5px] font-medium text-text-2">
                Desde
                <input
                  type="date"
                  value={desde}
                  max={hasta || hoy}
                  onChange={(e) => setDesde(e.target.value)}
                  autoFocus
                  className="rounded-[6px] border border-border bg-bg px-[8px] py-[6px] text-[13px] tabular-nums text-text outline-none focus:border-moe"
                />
              </label>
              <label className="flex flex-col gap-[3px] text-[11.5px] font-medium text-text-2">
                Hasta
                <input
                  type="date"
                  value={hasta}
                  min={desde || undefined}
                  max={hoy}
                  onChange={(e) => setHasta(e.target.value)}
                  className="rounded-[6px] border border-border bg-bg px-[8px] py-[6px] text-[13px] tabular-nums text-text outline-none focus:border-moe"
                />
              </label>
            </div>

            {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cerrar}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[14px] font-medium text-text-2 hover:bg-bg-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => aplicar(desde, hasta)}
                className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[14px] font-medium text-white hover:bg-moe/90"
              >
                Ver caja
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
