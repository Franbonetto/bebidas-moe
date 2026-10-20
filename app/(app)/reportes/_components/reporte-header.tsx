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
}: {
  titulo: string;
  bajada: string;
  base: string;
  periodo: Periodo;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-[16px] font-semibold text-text">{titulo}</h1>
        <p className="mt-[2px] text-[12.5px] text-text-3">{bajada}</p>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <PeriodoTabs base={base} actual={periodo} />
        <span className="text-[11.5px] text-text-3">{metaPeriodo(periodo)}</span>
      </div>
    </div>
  );
}
