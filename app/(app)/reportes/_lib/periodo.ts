import { inicioDeSemana, inicioDelDia, inicioDelMes } from "@/lib/fecha";

// Rango de fechas de un reporte. Todo reporte de este tipo arranca con el
// período arriba (es la gramática estándar de los reportes de POS: rango,
// después los números grandes, después los desgloses), y el período viaja
// en la URL -- así el dueño puede guardarse el link de "el mes" en el
// celular y no hay estado de cliente que sincronizar.
//
// Los cuatro cortes salen del día operativo de Argentina (lib/fecha.ts),
// nunca de la hora del servidor: a las 21:00 de acá, en UTC ya es mañana.
export type Periodo = "hoy" | "semana" | "mes" | "30d";

export const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "30d", label: "Últimos 30 días" },
];

const PERIODO_META: Record<Periodo, string> = {
  hoy: "Desde las 00:00 de hoy",
  semana: "Lunes a hoy",
  mes: "Del 1 a hoy",
  "30d": "Últimos 30 días corridos",
};

export function leerPeriodo(valor: string | undefined): Periodo {
  return PERIODOS.some((p) => p.id === valor) ? (valor as Periodo) : "hoy";
}

export function desdePeriodo(periodo: Periodo): Date {
  switch (periodo) {
    case "hoy":
      return inicioDelDia();
    case "semana":
      return inicioDeSemana();
    case "mes":
      return inicioDelMes();
    case "30d":
      return new Date(new Date().getTime() - 30 * 86_400_000);
  }
}

export function metaPeriodo(periodo: Periodo): string {
  return PERIODO_META[periodo];
}
