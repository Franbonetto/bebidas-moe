import Link from "next/link";
import { PERIODOS, type Periodo } from "../_lib/periodo";

// Mismas pestañas en todos los reportes. No es un componente de cliente:
// son links con ?periodo=, que además deja el rango en la URL.
//
// `actual` puede venir en null: es el caso de /reportes/caja mirando un día
// puntual, donde ningún período está elegido y hacer click en uno vuelve al
// reporte por rango.
export function PeriodoTabs({
  base,
  actual,
  sucursal,
}: {
  base: string;
  actual: Periodo | null;
  // Sucursal elegida (si el reporte la discrimina, ej. /reportes/caja): se
  // conserva al cambiar de período en vez de volver a la de siempre.
  sucursal?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PERIODOS.map((p) => (
        <Link
          key={p.id}
          href={`${base}?periodo=${p.id}${sucursal ? `&sucursal=${sucursal}` : ""}`}
          className={`rounded-[6px] border px-[10px] py-[4px] text-[12px] font-medium ${
            p.id === actual
              ? "border-moe bg-moe-soft text-moe"
              : "border-border bg-bg text-text-2 hover:bg-bg-2"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
