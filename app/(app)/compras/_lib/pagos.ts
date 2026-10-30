// Pago de una boleta a un proveedor. El estado (pagada / parcial / impaga)
// nunca se guarda como campo aparte: se calcula siempre desde el historial
// de compra_pagos, igual que la base lo hace en
// calcular_saldo_pendiente_compra() -- así no hay un flag que se pueda
// desincronizar del historial real.
//
// Solo lo ve el dueño (decisión del usuario 2026-10-30): Olavarría no tiene
// acceso a estos datos ni a esta pantalla de pagos.

export type MedioPago = "efectivo" | "transferencia";

export const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
};

export type TipoPago = "pago" | "reversa";

export type CompraPago = {
  id: string;
  compra_id: string;
  tipo: TipoPago;
  monto: number;
  medio_pago: MedioPago;
  nota: string | null;
  pago_original_id: string | null;
  fecha: string;
  usuario: { nombre: string } | null;
};

export function totalAbonadoCompra(pagos: { tipo: TipoPago; monto: number }[]): number {
  const total = pagos.reduce((acc, p) => acc + (p.tipo === "pago" ? p.monto : -p.monto), 0);
  return Math.round(total * 100) / 100;
}

export type EstadoPagoCompra = "pagada" | "parcial" | "impaga";

export const ESTADO_PAGO_LABEL: Record<EstadoPagoCompra, string> = {
  pagada: "Pagada",
  parcial: "Pago parcial",
  impaga: "Impaga",
};

// Margen de un centavo para no dejar "pago parcial" colgado por redondeo.
export function estadoPagoCompra(totalAPagar: number, totalAbonado: number): EstadoPagoCompra {
  if (totalAbonado <= 0) return "impaga";
  if (totalAbonado >= totalAPagar - 0.01) return "pagada";
  return "parcial";
}

// Un pago 'pago' ya anulado no se puede volver a anular.
export function pagoYaAnulado(pagoId: string, pagos: CompraPago[]): boolean {
  return pagos.some((p) => p.pago_original_id === pagoId);
}

// Vencimiento de la boleta según el plazo configurado en Proveedores
// (proveedores.plazo_dias). Fecha pelada, se suma en UTC a propósito para
// no depender de la zona del navegador -- mismo criterio que el resto de
// las fechas `date` de esta pantalla (_lib/formato.ts: "2026-10-01" se lee
// como medianoche UTC).
export function fechaVencimientoPago(fechaFacturaIso: string | null, plazoDias: number | null): Date | null {
  if (!fechaFacturaIso || plazoDias == null) return null;
  const fecha = new Date(`${fechaFacturaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + plazoDias);
  return fecha;
}
