// Sin "use client": esta función la llaman tanto componentes cliente
// (formularios, tablas interactivas) como server components (dashboards).
// Vivía en productos-table.tsx, pero ese archivo es "use client" y una
// función exportada desde un módulo cliente no se puede invocar desde el
// servidor -- de ahí que quedara acá, en un módulo neutro, y
// productos-table.tsx la reexporte para no romper a sus consumidores.

export type SkuPresentacion = {
  tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
  volumen: number;
  unidad_volumen: string;
  unidades_contenidas: number;
};

export function presentacionLabel(sku: SkuPresentacion) {
  const volumen = `${sku.volumen} ${sku.unidad_volumen}`;
  switch (sku.tipo_presentacion) {
    case "pack":
      return `Pack x${sku.unidades_contenidas} · ${volumen}`;
    case "cajon":
      return `Cajón x${sku.unidades_contenidas} · ${volumen}`;
    case "estuche":
      return `Estuche x${sku.unidades_contenidas} · ${volumen}`;
    default:
      return volumen;
  }
}
