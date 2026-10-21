// Comprobante fiscal de una compra: con qué vino la mercadería y cuánto de
// ese total es IVA. Es lo que alimenta el balance de IVA del panel del
// dueño (/reportes/iva) -- ver supabase/migrations/20260928090000.
//
// Criterio confirmado por el usuario 2026-09-28: solo la Factura A da
// crédito fiscal computable (Moe es Responsable Inscripto: como receptor,
// la B no le discrimina IVA y el remito no existe fiscalmente).

export type TipoComprobante = "factura_a" | "factura_b" | "remito";

// Lo que se puede elegir al cargar mercadería. La Factura B salió de la
// lista (usuario 2026-10-04): a un Responsable Inscripto los proveedores le
// facturan A, así que la opción solo servía para elegirla por error y perder
// el crédito fiscal de esa compra.
//
// El tipo y la etiqueta se mantienen porque una compra vieja puede tener
// 'factura_b' cargada y tiene que seguir mostrándose bien.
export const TIPOS_COMPROBANTE: TipoComprobante[] = ["factura_a", "remito"];

export const TIPO_COMPROBANTE_LABEL: Record<TipoComprobante, string> = {
  factura_a: "Factura A",
  factura_b: "Factura B",
  remito: "Remito",
};

// Lo que ve la encargada al elegir. En castellano y en términos de lo que
// pasa, no de jerga fiscal.
export const TIPO_COMPROBANTE_AYUDA: Record<TipoComprobante, string> = {
  factura_a: "Con IVA discriminado. Es la única que descuenta IVA.",
  factura_b: "Sin IVA discriminado. No descuenta IVA.",
  remito: "Sin comprobante fiscal. No descuenta IVA.",
};

export function daCreditoFiscal(tipo: TipoComprobante | null): boolean {
  return tipo === "factura_a";
}

// El costo que se carga por línea es el precio final pagado, IVA incluido
// (decisión del usuario 2026-09-28), así que el neto sale para atrás:
// neto = total / (1 + alícuota/100). Mismo cálculo que usa la facturación
// de ventas en app/(app)/vender/facturar/actions.ts, en el otro sentido.
export function desglosarIva(totalConIva: number, alicuotaIva: number) {
  const neto = totalConIva / (1 + alicuotaIva / 100);
  return { neto, iva: totalConIva - neto };
}

// Desglose de una compra entera, agrupando por alícuota (hoy todo el
// catálogo va al 21%, pero el dato vive en la categoría justamente para
// que esto no asuma nada -- ver 20260907090000_categorias_alicuota_iva.sql).
export function desglosarIvaCompra(
  lineas: { total: number; alicuotaIva: number }[],
): { neto: number; iva: number } {
  let neto = 0;
  let iva = 0;
  for (const linea of lineas) {
    const desglose = desglosarIva(linea.total, linea.alicuotaIva);
    neto += desglose.neto;
    iva += desglose.iva;
  }
  return { neto, iva };
}

// Lo que realmente se pagó: el total que figura abajo de todo en la
// factura (neto + internos + IVA + percepciones), más el flete si se pagó
// aparte. Las líneas solas nunca son ese número -- les faltan los impuestos
// del pie.
//
// Sirve igual carguen las líneas en neto o con IVA adentro: el pie se copia
// tal cual del papel, así que neto + IVA ya es lo que suman las líneas en
// un caso y el neto solo en el otro.
//
// Sin pie cargado (remito, o una compra vieja sin clasificar) lo único que
// se sabe es lo que suman las líneas, más el flete.
export function totalPagadoCompra(compra: {
  total: number;
  neto_gravado: number | null;
  iva: number | null;
  impuestos_internos: number | null;
  percepcion_iva: number | null;
  percepcion_iibb: number | null;
  flete?: number | null;
}): number {
  const flete = compra.flete ?? 0;
  if (compra.neto_gravado === null || compra.iva === null)
    return redondearPeso(compra.total + flete);
  return redondearPeso(
    compra.neto_gravado +
      (compra.impuestos_internos ?? 0) +
      compra.iva +
      (compra.percepcion_iva ?? 0) +
      (compra.percepcion_iibb ?? 0) +
      flete,
  );
}

// Una compra tiene pie cuando se copió el cuadro fiscal del papel. Es lo
// que habilita mostrar el desglose.
export function tienePieFiscal(compra: { neto_gravado: number | null; iva: number | null }): boolean {
  return compra.neto_gravado !== null && compra.iva !== null;
}

// Lo que el sistema reparte entre las líneas para saber cuánto salió de
// verdad cada unidad: los impuestos del pie y el flete pagado aparte. Un
// remito con flete no tiene pie pero sí tiene algo que repartir, así que no
// alcanza con tienePieFiscal() para decidir si mostrar el desglose.
export function tieneDesglose(compra: {
  neto_gravado: number | null;
  iva: number | null;
  flete?: number | null;
}): boolean {
  return tienePieFiscal(compra) || !!compra.flete;
}

export function redondearPeso(valor: number): number {
  return Math.round(valor * 100) / 100;
}
