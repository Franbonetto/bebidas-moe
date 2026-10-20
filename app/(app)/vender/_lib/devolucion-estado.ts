// Estado de devolución de una venta. No es una columna de `ventas`: la
// venta no se modifica nunca (CLAUDE.md, regla 2 -- los movimientos y las
// ventas son inmutables), así que esto se deriva comparando las unidades
// vendidas contra las unidades que volvieron en `devolucion_items`.
//
// 'total'   = volvieron todas las unidades de la venta.
// 'parcial' = volvió algo, pero no todo.
//
// Una venta sin devoluciones no entra en el Map que arma
// devolucionesPorVenta(): la ausencia es el tercer estado.
export type EstadoDevolucion = "total" | "parcial";

// Cartel rojo (pedido del usuario 2026-10-19). Los dos avisan lo mismo
// -- "ojo, por esta venta volvió mercadería" -- por eso comparten el rojo
// y se diferencian por el texto, no por el color.
export const BADGE_DEVOLUCION: Record<EstadoDevolucion, { label: string; className: string }> = {
  total: { label: "Venta devuelta", className: "bg-err-bg text-err" },
  parcial: { label: "Devuelta en parte", className: "border border-err/30 bg-err-bg/60 text-err" },
};
