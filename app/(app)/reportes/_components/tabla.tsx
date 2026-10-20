import type { ReactNode } from "react";

// Tabla densa y escaneable, el formato que piden los reportes
// (docs/identidad-visual.md: bordes suaves, sin sombras, números con
// tabular-nums). Vive acá para que las cuatro pantallas de reportes se
// vean iguales y no se repita el markup en cada una.

export function Tabla({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children?: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-[11.5px] font-medium text-text-2 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Tr({ children, total = false }: { children: ReactNode; total?: boolean }) {
  return (
    <tr
      className={`border-b border-[#F1F1F3] last:border-b-0 ${
        total ? "bg-bg-2 font-semibold" : "hover:bg-[#FAFAFB]"
      }`}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = "left",
  numero = false,
  mute = false,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  numero?: boolean;
  mute?: boolean;
}) {
  return (
    <td
      className={`px-[14px] py-[9px] align-middle ${align === "right" ? "text-right" : ""} ${
        numero ? "tabular-nums" : ""
      } ${mute ? "text-text-3" : "text-text-2"}`}
    >
      {children}
    </td>
  );
}
