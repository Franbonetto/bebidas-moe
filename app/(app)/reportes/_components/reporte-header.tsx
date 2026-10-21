import type { ReactNode } from "react";
import type { Periodo } from "../_lib/periodo";
import { metaPeriodo } from "../_lib/periodo";
import { PeriodoTabs } from "./periodo-tabs";

// Encabezado común de los reportes: título, qué contesta la pantalla y el
// selector de período.
export function ReporteHeader({
  titulo,
  bajada,
  base,
  periodo,
  extra,
  meta,
}: {
  titulo: string;
  bajada: string;
  base: string;
  // null = no hay período elegido porque se está mirando otra cosa (un día
  // puntual en /reportes/caja).
  periodo: Periodo | null;
  // Al lado de las pestañas: hoy solo lo usa caja, para el selector de día.
  extra?: ReactNode;
  // Reemplaza la aclaración del rango cuando lo que se mira no es un
  // período.
  meta?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-[16px] font-semibold text-text">{titulo}</h1>
        <p className="mt-[2px] text-[12.5px] text-text-3">{bajada}</p>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodoTabs base={base} actual={periodo} />
          {extra}
        </div>
        <span className="text-[11.5px] text-text-3">
          {meta ?? (periodo ? metaPeriodo(periodo) : "")}
        </span>
      </div>
    </div>
  );
}
