import Link from "next/link";
import { PERIODOS, type Periodo } from "../_lib/periodo";

// Mismas pestañas en todos los reportes. No es un componente de cliente:
// son links con ?periodo=, que además deja el rango en la URL.
export function PeriodoTabs({ base, actual }: { base: string; actual: Periodo }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PERIODOS.map((p) => (
        <Link
          key={p.id}
          href={`${base}?periodo=${p.id}`}
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
