// Helpers puros compartidos por los tres paneles de Inicio. Sin fetch acá
// adentro a propósito: cada dashboard trae sus propias filas (mismo patrón
// que el resto de la app, ver productos/page.tsx) y estas funciones solo
// las reducen/derivan.

export function haceDias(fechaIso: string): string {
  const dias = Math.floor((Date.now() - new Date(fechaIso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}

export type CostoSubio = {
  sku_id: string;
  costo_anterior: number;
  costo_nuevo: number;
  variacion_pct: number;
  fecha: string;
};

// Compara, por SKU, el último lote recibido contra el anterior
// (historial_costos, arquitectura.md 2.5) y se queda con los que subieron
// dentro de la ventana de evento de 30 días (arquitectura.md 1.12: "las
// alertas de evento usan ventana de 30 días"). `historial` tiene que venir
// ordenado por fecha descendente -- así el primer registro de cada SKU es
// el último lote y el segundo el anterior, sin volver a ordenar acá.
export function calcularCostosQueSubieron(
  historial: { sku_id: string; costo_unitario: number; fecha: string }[],
  ventanaDias = 30,
): CostoSubio[] {
  const cutoff = Date.now() - ventanaDias * 86_400_000;
  const porSku = new Map<string, { costo_unitario: number; fecha: string }[]>();

  for (const fila of historial) {
    const filas = porSku.get(fila.sku_id) ?? [];
    filas.push(fila);
    porSku.set(fila.sku_id, filas);
  }

  const resultado: CostoSubio[] = [];
  for (const [sku_id, filas] of porSku) {
    if (filas.length < 2) continue;
    const [ultimo, anterior] = filas;
    if (new Date(ultimo.fecha).getTime() < cutoff) continue;
    if (ultimo.costo_unitario <= anterior.costo_unitario) continue;

    resultado.push({
      sku_id,
      costo_anterior: anterior.costo_unitario,
      costo_nuevo: ultimo.costo_unitario,
      variacion_pct: ((ultimo.costo_unitario - anterior.costo_unitario) / anterior.costo_unitario) * 100,
      fecha: ultimo.fecha,
    });
  }

  return resultado.sort((a, b) => b.variacion_pct - a.variacion_pct);
}
