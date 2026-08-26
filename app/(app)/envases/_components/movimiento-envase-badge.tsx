export type TipoMovimientoEnvase = "ingreso_cliente" | "devolucion_proveedor" | "ajuste";

export const TIPO_MOVIMIENTO_ENVASE_LABEL: Record<TipoMovimientoEnvase, string> = {
  ingreso_cliente: "Ingreso de cliente",
  devolucion_proveedor: "Devolución a proveedor",
  ajuste: "Ajuste",
};

// Verde = entrada (OK), naranja = salida hacia el proveedor (arquitectura.md
// 1.4: es un activo que sale, no una venta), amarillo = ajuste manual —
// mismos colores universales suaves de docs/identidad-visual.md.
const TIPO_MOVIMIENTO_ENVASE_CLASS: Record<TipoMovimientoEnvase, string> = {
  ingreso_cliente: "bg-ok-bg text-ok",
  devolucion_proveedor: "bg-orange-bg text-orange",
  ajuste: "bg-warn-bg text-warn",
};

export function MovimientoEnvaseBadge({ tipo }: { tipo: TipoMovimientoEnvase }) {
  return (
    <span
      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${TIPO_MOVIMIENTO_ENVASE_CLASS[tipo]}`}
    >
      {TIPO_MOVIMIENTO_ENVASE_LABEL[tipo]}
    </span>
  );
}
