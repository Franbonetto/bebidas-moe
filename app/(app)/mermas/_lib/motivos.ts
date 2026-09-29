// Motivos de merma. Viven acá y no en actions.ts porque un archivo
// "use server" solo puede exportar funciones async: una constante exportada
// desde ahí rompe el build.
//
// Lista cerrada a propósito (misma decisión que los motivos de diferencia de
// inventario): con texto libre, dentro de seis meses no se puede responder
// "cuánto perdí por rotura" sin leer fila por fila.

export const MOTIVOS_MERMA = ["rotura", "vencido", "consumo_interno", "otro"] as const;
export type MotivoMerma = (typeof MOTIVOS_MERMA)[number];

export const MOTIVO_MERMA_LABEL: Record<MotivoMerma, string> = {
  rotura: "Rotura",
  vencido: "Vencido",
  consumo_interno: "Consumo interno",
  otro: "Otro",
};
