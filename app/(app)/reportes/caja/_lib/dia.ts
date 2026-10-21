import { fechaOperativa } from "@/lib/fecha";

// El día que se está mirando en /reportes/caja viaja en la URL como
// ?dia=AAAA-MM-DD, que es el mismo formato de `cajas.fecha` (date pelado,
// día operativo de Argentina -- ver lib/fecha.ts).
//
// Todas las cuentas del día se anclan al mediodía: sumar o restar 24hs
// sobre las 12:00 cae siempre en el mismo horario local, así que nunca se
// salta ni repite un día. Argentina no tiene horario de verano, pero el
// mediodía lo deja bien igual si algún día volviera.

const FORMATO = /^\d{4}-\d{2}-\d{2}$/;

function mediodia(dia: string): Date {
  return new Date(`${dia}T12:00:00-03:00`);
}

// null = no se pidió ningún día (o el parámetro vino roto): la pantalla
// muestra el reporte por período, como siempre.
export function leerDia(valor: string | undefined): string | null {
  if (!valor || !FORMATO.test(valor)) return null;
  const fecha = mediodia(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  // Rebota una fecha inventada tipo 2026-02-31, que el constructor acepta
  // corriéndola de mes.
  return fechaOperativa(fecha) === valor ? valor : null;
}

export function diaAnterior(dia: string): string {
  return fechaOperativa(new Date(mediodia(dia).getTime() - 86_400_000));
}

export function diaSiguiente(dia: string): string {
  return fechaOperativa(new Date(mediodia(dia).getTime() + 86_400_000));
}

// Para mostrar el día en pantalla sin que el formateador lo corra al día
// anterior: "2026-10-21" como date pelado es medianoche UTC, que en
// Argentina todavía es el 20.
export function fechaDelDia(dia: string): Date {
  return mediodia(dia);
}
