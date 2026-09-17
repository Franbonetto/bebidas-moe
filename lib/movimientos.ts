import {
  MOTIVO_INVENTARIO_LABEL,
  type MotivoInventario,
} from "@/app/(app)/inventarios/_components/estado-inventario-badge";

export const TIPO_MOVIMIENTO_LABEL: Record<string, string> = {
  compra: "Entrada por compra",
  venta: "Salida por venta",
  transferencia_salida: "Salida por transferencia",
  transferencia_entrada: "Entrada por transferencia",
  ajuste: "Ajuste de inventario",
  merma: "Merma",
  devolucion_entrada: "Devolución",
  desarme_salida: "Desarme (salida)",
  desarme_entrada: "Desarme (entrada)",
  cambio_salida: "Salida por cambio",
};

// El motivo de un movimiento es texto libre salvo para 'ajuste', donde lo
// pone confirmar_inventario() con el vocabulario cerrado de inventarios
// (rotura, error_carga, etc. -- bloque 8). Solo ahí tiene sentido traducirlo
// con la misma etiqueta que usa el gráfico de diferencias.
export function motivoLegible(motivo: string | null, tipo: string): string | null {
  if (!motivo) return null;
  if (tipo === "ajuste" && motivo in MOTIVO_INVENTARIO_LABEL) {
    return MOTIVO_INVENTARIO_LABEL[motivo as MotivoInventario];
  }
  return motivo;
}
