export type EstadoPedido =
  | "borrador"
  | "enviado"
  | "en_preparacion"
  | "preparado"
  | "despachado"
  | "cerrado";

export const ESTADO_PEDIDO_LABEL: Record<EstadoPedido, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  en_preparacion: "En preparación",
  preparado: "Preparado",
  despachado: "En tránsito",
  cerrado: "Cerrado",
};

// Azul = tránsito/información, verde = OK, amarillo = atención, naranja =
// importante (docs/identidad-visual.md).
const ESTADO_PEDIDO_CLASS: Record<EstadoPedido, string> = {
  borrador: "bg-bg-2 text-text-2",
  enviado: "bg-info-bg text-info",
  en_preparacion: "bg-warn-bg text-warn",
  preparado: "bg-orange-bg text-orange",
  despachado: "bg-info-bg text-info",
  cerrado: "bg-ok-bg text-ok",
};

export function EstadoPedidoBadge({ estado }: { estado: EstadoPedido }) {
  return (
    <span
      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${ESTADO_PEDIDO_CLASS[estado]}`}
    >
      {ESTADO_PEDIDO_LABEL[estado]}
    </span>
  );
}
