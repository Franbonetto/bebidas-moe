"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { diaAnterior, diaSiguiente } from "../_lib/dia";

// Elegir un día puntual al lado de las pestañas de período. El día viaja en
// la URL (?dia=AAAA-MM-DD) igual que el período, así que el dueño puede
// guardarse el link de un día concreto.
//
// Las flechas son links comunes; lo único que necesita JavaScript es el
// calendario, que navega al soltar la fecha.
export function SelectorDia({
  base,
  dia,
  hoy,
  sucursal,
}: {
  base: string;
  // null = todavía no se eligió ninguno: se está viendo el reporte por
  // período y el campo aparece vacío.
  dia: string | null;
  hoy: string;
  // Sucursal elegida: se conserva al moverse de día, en vez de volver a la
  // de siempre.
  sucursal?: string;
}) {
  const router = useRouter();

  const sufijoSucursal = sucursal ? `&sucursal=${sucursal}` : "";
  const flechaClass =
    "rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-[12px] font-medium text-text-2 hover:bg-bg-2";

  return (
    <div className="flex items-center gap-1">
      {dia && (
        <Link
          href={`${base}?dia=${diaAnterior(dia)}${sufijoSucursal}`}
          className={flechaClass}
          aria-label="Día anterior"
          title="Día anterior"
        >
          ←
        </Link>
      )}

      <input
        type="date"
        value={dia ?? ""}
        max={hoy}
        aria-label="Ver un día"
        title="Elegí un día para ver su caja"
        className={`rounded-[6px] border px-[8px] py-[4px] text-[12px] tabular-nums outline-none focus:border-moe ${
          dia ? "border-moe bg-moe-soft text-moe" : "border-border bg-bg text-text-2"
        }`}
        onChange={(e) => {
          if (e.target.value) router.push(`${base}?dia=${e.target.value}${sufijoSucursal}`);
        }}
      />

      {/* Un día adelante solo mientras no se pase de hoy: del futuro no hay
          caja para mostrar. */}
      {dia && dia < hoy && (
        <Link
          href={`${base}?dia=${diaSiguiente(dia)}${sufijoSucursal}`}
          className={flechaClass}
          aria-label="Día siguiente"
          title="Día siguiente"
        >
          →
        </Link>
      )}
    </div>
  );
}
