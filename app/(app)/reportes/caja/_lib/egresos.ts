import { ZONA_ARGENTINA } from "@/lib/fecha";
import { fechaDelDia } from "./dia";

// Detalle de los egresos de efectivo (pedido del usuario 2026-11-10): lo que
// salió del cajón en efectivo, día por día y con la nota de cada uno. Son las
// salidas de caja (movimientos_caja, con el motivo que escribió quien lo hizo)
// y las devoluciones pagadas en efectivo (con sus observaciones). Cada egreso
// va al día de la caja donde ocurrió, igual que el resto del reporte.

export type EgresoEfectivo = {
  // Día de la caja (AAAA-MM-DD).
  dia: string;
  // Para ordenar dentro del día.
  creadoEn: string;
  hora: string;
  tipo: "salida" | "devolucion";
  nota: string;
  quien: string;
  monto: number;
  ventaId: string | null;
};

export type GrupoEgresos = {
  dia: string;
  etiqueta: string;
  total: number;
  items: EgresoEfectivo[];
};

const formatoDiaLargo = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: ZONA_ARGENTINA,
});

// Agrupa por día, del más reciente al más viejo, y dentro del día del más
// reciente al más viejo.
export function agruparEgresos(egresos: EgresoEfectivo[]): GrupoEgresos[] {
  const porDia = new Map<string, EgresoEfectivo[]>();
  for (const e of egresos) {
    const lista = porDia.get(e.dia);
    if (lista) lista.push(e);
    else porDia.set(e.dia, [e]);
  }
  return [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dia, items]) => ({
      dia,
      etiqueta: formatoDiaLargo.format(fechaDelDia(dia)),
      total: items.reduce((acc, e) => acc + e.monto, 0),
      items: [...items].sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1)),
    }));
}
