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

export type ProductoPorVencer = {
  sku_id: string;
  fecha_vencimiento: string;
  dias_restantes: number;
};

// Del último lote recibido por SKU con fecha_vencimiento cargada
// (historial_costos.fecha_vencimiento, opcional -- no todo vence, ver
// migración 20260922110000), se queda con los que vencen dentro de la
// ventana (incluye los ya vencidos, dias_restantes negativo). `historial`
// viene ordenado por fecha descendente, así el primer registro de cada SKU
// es el último lote -- mismo criterio que calcularCostosQueSubieron.
export function calcularProductosPorVencer(
  historial: { sku_id: string; fecha_vencimiento: string | null; fecha: string }[],
  ventanaDias = 30,
): ProductoPorVencer[] {
  const vistos = new Set<string>();
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const limite = hoy.getTime() + ventanaDias * 86_400_000;

  const resultado: ProductoPorVencer[] = [];
  for (const fila of historial) {
    if (vistos.has(fila.sku_id)) continue;
    vistos.add(fila.sku_id);
    if (!fila.fecha_vencimiento) continue;

    const vencimiento = new Date(`${fila.fecha_vencimiento}T00:00:00`).getTime();
    if (vencimiento > limite) continue;

    resultado.push({
      sku_id: fila.sku_id,
      fecha_vencimiento: fila.fecha_vencimiento,
      dias_restantes: Math.round((vencimiento - hoy.getTime()) / 86_400_000),
    });
  }

  return resultado.sort((a, b) => a.dias_restantes - b.dias_restantes);
}

export type ResumenVentas = {
  vendidoHoy: number;
  vendidoSemana: number;
  vendidoMes: number;
  ticketPromedio: number;
  cantidadTickets: number;
};

// Lunes 00:00 de la semana que contiene `fecha` (pedido del usuario
// 2026-09-22: "lunes a domingo... al cierre hasta las 22 horas" -- el
// local cierra a las 22, así que una semana corrida de lunes 00:00 a
// domingo ya cubre toda venta del día sin necesidad de un corte especial
// a las 22, esa hora nunca queda afuera de "hoy"). getDay(): 0 = domingo.
export function inicioDeSemana(fecha: Date): Date {
  const resultado = new Date(fecha);
  const dia = resultado.getDay();
  const diasDesdeLunes = dia === 0 ? 6 : dia - 1;
  resultado.setDate(resultado.getDate() - diasDesdeLunes);
  resultado.setHours(0, 0, 0, 0);
  return resultado;
}

// Resumen de ventas de una sucursal para el panel del dueño (pedido del
// usuario 2026-09-22: "ticket promedio, cuáles son los productos que más
// se venden" + "vendido esta semana"). `ventasHoy`/`ventasSemana`/
// `ventasMes`/`ventasVentana` ya vienen filtradas por sucursal y estado =
// 'confirmada' -- esta función solo suma/promedia, no filtra (mismo
// criterio que el resto de los helpers de este archivo).
export function calcularResumenVentas(
  ventasHoy: { total: number }[],
  ventasSemana: { total: number }[],
  ventasMes: { total: number }[],
  ventasVentana: { total: number }[],
): ResumenVentas {
  const vendidoHoy = ventasHoy.reduce((acc, v) => acc + v.total, 0);
  const vendidoSemana = ventasSemana.reduce((acc, v) => acc + v.total, 0);
  const vendidoMes = ventasMes.reduce((acc, v) => acc + v.total, 0);
  const totalVentana = ventasVentana.reduce((acc, v) => acc + v.total, 0);
  const cantidadTickets = ventasVentana.length;
  return {
    vendidoHoy,
    vendidoSemana,
    vendidoMes,
    ticketPromedio: cantidadTickets > 0 ? totalVentana / cantidadTickets : 0,
    cantidadTickets,
  };
}

export type ProductoInmovilizado = {
  sku_id: string;
  stock: number;
  ultima_venta: string | null;
  dias_sin_venta: number | null;
};

// Productos con stock hoy ordenados por hace cuánto no se venden (pedido
// del usuario 2026-09-22: "los 30, 40 productos que no se venden, y cada
// uno la última vez que se vendió" -- a diferencia del criterio anterior
// de "último movimiento" (cualquier tipo: compra, ajuste, etc.), acá es
// específicamente venta). `ventasPorSku` tiene que venir ordenado por
// fecha descendente y ya filtrado a movimientos tipo = 'venta' -- así el
// primer registro de cada SKU es la venta más reciente. dias_sin_venta
// null = nunca se vendió (peor caso, va primero).
export function calcularMercaderiaInmovilizada(
  stockPorSku: { sku_id: string; stock: number }[],
  ventasPorSku: { sku_id: string; fecha: string }[],
  limite = 40,
): ProductoInmovilizado[] {
  const ultimaVentaPorSku = new Map<string, string>();
  for (const v of ventasPorSku) {
    if (!ultimaVentaPorSku.has(v.sku_id)) ultimaVentaPorSku.set(v.sku_id, v.fecha);
  }

  const hoy = Date.now();
  return stockPorSku
    .filter((f) => f.stock > 0)
    .map((f) => {
      const ultimaVenta = ultimaVentaPorSku.get(f.sku_id) ?? null;
      return {
        sku_id: f.sku_id,
        stock: f.stock,
        ultima_venta: ultimaVenta,
        dias_sin_venta: ultimaVenta ? Math.floor((hoy - new Date(ultimaVenta).getTime()) / 86_400_000) : null,
      };
    })
    .sort((a, b) => {
      if (a.dias_sin_venta == null && b.dias_sin_venta == null) return 0;
      if (a.dias_sin_venta == null) return -1;
      if (b.dias_sin_venta == null) return 1;
      return b.dias_sin_venta - a.dias_sin_venta;
    })
    .slice(0, limite);
}

export type ProductoVendido = { sku_id: string; unidades: number };

// Top de SKU por unidades vendidas dentro de la ventana ya filtrada en
// `items` (venta_items de ventas confirmadas de una sucursal).
export function topProductosVendidos(items: { sku_id: string; cantidad: number }[], limite = 10): ProductoVendido[] {
  const porSku = new Map<string, number>();
  for (const item of items) porSku.set(item.sku_id, (porSku.get(item.sku_id) ?? 0) + item.cantidad);
  return [...porSku.entries()]
    .map(([sku_id, unidades]) => ({ sku_id, unidades }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, limite);
}
