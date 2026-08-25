export type EstadoInventario = "abierto" | "cerrado";

export const ESTADO_INVENTARIO_LABEL: Record<EstadoInventario, string> = {
  abierto: "Abierto",
  cerrado: "Cerrado",
};

// Azul = tránsito/información, verde = OK (docs/identidad-visual.md).
const ESTADO_INVENTARIO_CLASS: Record<EstadoInventario, string> = {
  abierto: "bg-info-bg text-info",
  cerrado: "bg-ok-bg text-ok",
};

export function EstadoInventarioBadge({ estado }: { estado: EstadoInventario }) {
  return (
    <span
      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${ESTADO_INVENTARIO_CLASS[estado]}`}
    >
      {ESTADO_INVENTARIO_LABEL[estado]}
    </span>
  );
}

export type TipoInventario = "general" | "categoria" | "puntual";

export const TIPO_INVENTARIO_LABEL: Record<TipoInventario, string> = {
  general: "General",
  categoria: "Por categoría",
  puntual: "Puntual",
};

export type MotivoInventario =
  | "rotura"
  | "robo"
  | "error_carga"
  | "error_conteo_previo"
  | "vencimiento"
  | "desconocido";

export const MOTIVO_INVENTARIO_LABEL: Record<MotivoInventario, string> = {
  rotura: "Rotura",
  robo: "Robo",
  error_carga: "Error de carga",
  error_conteo_previo: "Error de conteo previo",
  vencimiento: "Vencimiento",
  desconocido: "Desconocido",
};

export const MOTIVOS_INVENTARIO: MotivoInventario[] = [
  "rotura",
  "robo",
  "error_carga",
  "error_conteo_previo",
  "vencimiento",
  "desconocido",
];
