// Fecha operativa del negocio: la de Argentina, no la del servidor.
//
// Por qué existe este archivo (2026-10-19): el servidor de Vercel corre en
// UTC y la base de Supabase también, así que `new Date()` y `current_date`
// cambian de día a las 21:00 de Argentina. El local cierra a las 22. El
// resultado era que a las 21 el sistema ya pensaba que era mañana:
//
//   - el POS perdía la caja del día y pedía abrir una nueva;
//   - confirmar_venta() cortaba con "Todavia no se abrio la caja de hoy",
//     o sea no se podía vender entre las 21 y las 00;
//   - "vendido hoy" del panel del dueño volvía a cero;
//   - una promoción que vencía ese día dejaba de aplicar 3hs antes;
//   - y, desde que se factura automático, las facturas de la noche salían
//     con CbteFch del día siguiente.
//
// Argentina no tiene horario de verano desde 2009: es UTC-3 todo el año.
// Por eso alcanza con el offset fijo y no hace falta una librería de
// zonas. Si algún día volviera el horario de verano, lo que hay que
// cambiar es este archivo y nada más.
//
// El equivalente en la base es fecha_operativa() -- ver
// supabase/migrations/20261019100000_fecha_operativa.sql.

const ZONA = "America/Argentina/Buenos_Aires";
const OFFSET = "-03:00";

// "AAAA-MM-DD" del día en Argentina. Es el formato de `cajas.fecha` y de
// las vigencias de promociones, que son `date` pelado en la base.
export function fechaOperativa(fecha: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(fecha);

  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

// El instante exacto en que empezó el día de hoy en Argentina. Sirve para
// comparar contra `fecha` de ventas y movimientos, que son timestamptz.
export function inicioDelDia(fecha: Date = new Date()): Date {
  return new Date(`${fechaOperativa(fecha)}T00:00:00${OFFSET}`);
}

// Primer día del mes, 00:00 de Argentina.
export function inicioDelMes(fecha: Date = new Date()): Date {
  return new Date(`${fechaOperativa(fecha).slice(0, 7)}-01T00:00:00${OFFSET}`);
}

// Lunes 00:00 de Argentina de la semana que contiene `fecha` (la semana del
// negocio es lunes a domingo, pedido del usuario 2026-09-22). Se resta en
// milisegundos sobre el inicio del día: sin horario de verano, restar 24hs
// siempre cae en el mismo horario local.
export function inicioDeSemana(fecha: Date = new Date()): Date {
  const inicio = inicioDelDia(fecha);
  // getUTCDay() del instante 03:00 UTC = el día de la semana en Argentina.
  const dia = inicio.getUTCDay(); // 0 = domingo
  const diasDesdeLunes = dia === 0 ? 6 : dia - 1;
  return new Date(inicio.getTime() - diasDesdeLunes * 86_400_000);
}
