// Comprobante fiscal de una compra: con qué vino la mercadería y cuánto de
// ese total es IVA. Es lo que alimenta el balance de IVA del panel del
// dueño (/reportes/iva) -- ver supabase/migrations/20260928090000.
//
// Criterio confirmado por el usuario 2026-09-28: solo la Factura A da
// crédito fiscal computable (Moe es Responsable Inscripto: como receptor,
// la B no le discrimina IVA y el remito no existe fiscalmente).

export type TipoComprobante = "factura_a" | "factura_b" | "remito";

export const TIPOS_COMPROBANTE: TipoComprobante[] = ["factura_a", "factura_b", "remito"];

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

export function redondearPeso(valor: number): number {
  return Math.round(valor * 100) / 100;
}
