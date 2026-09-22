// Calculo de precios de venta. Deliberadamente NO vive en la base de datos:
// el precio se resuelve al vuelo a partir de precios/recargos/descuentos
// (ver supabase/migrations/20260901120000_bloque5_precios.sql), nunca se
// guarda ni se cachea.
//
// Pensado para reusarse tal cual desde el POS (bloque 6) ademas de la
// pantalla de Precios: por eso no depende de nada de React/Next.
//
// 2026-09-22: se eliminó la cascada automática de cerveza en lata (x24 ->
// x6 -> unidad calculados solos a partir de un precio base). Cada SKU
// carga su propio precio de venta siempre a mano, sin excepción -- distintas
// cervezas se manejan con márgenes distintos, no hay una fórmula única que
// sirva para todas. El desarme físico de stock (otro archivo,
// desarmar_sku()) no tiene relación con esto y sigue igual.

export type SkuParaPrecio = {
  id: string;
  categoriaId: string;
  unidadesContenidas: number;
};

export type SucursalParaPrecio = {
  id: string;
  esCentral: boolean;
};

export type ContextoPrecio = {
  // costo_actual del propio SKU (skus.costo_actual). Null si nunca se
  // recibio una compra de este SKU puntual. Solo se usa para el aviso de
  // "precio por debajo del costo".
  costoActualPropio: number | null;
  // precios_sucursal.precio_override para (sucursal, sku), si existe.
  overridePrecio: number | null;
  // precios.precio_base, cargado a mano.
  precioBaseManual: number | null;
  // recargos_sku.monto_fijo para (sucursal, sku), si existe.
  recargoSkuMonto: number | null;
  // recargos_sucursal.monto_fijo para (sucursal, categoria del producto).
  recargoCategoriaMonto: number | null;
  // descuentos_efectivo.porcentaje para (sucursal, categoria), si existe.
  descuentoEfectivoPct: number | null;
};

export type Origen = "excepcion" | "manual" | "recargo" | "sin_precio";

export type PrecioVenta = {
  origen: Origen;
  esExcepcion: boolean;
  precioBase: number | null;
  precioEfectivo: number | null;
  precioOtroMedio: number | null;
  bajoCostoEfectivo: boolean;
  bajoCostoOtroMedio: boolean;
  // Expuesto para el motor de promociones (bloque 6): un combo o un 2x
  // puede dejar el precio por debajo de costo aunque el precio base no lo
  // estuviera, y necesita el mismo costo de referencia para advertirlo.
  costoReferencia: number | null;
};

export function calcularPrecioVenta(
  sku: SkuParaPrecio,
  sucursal: SucursalParaPrecio,
  ctx: ContextoPrecio,
): PrecioVenta {
  let precioBase: number | null = null;
  let origen: Origen = "sin_precio";
  const esExcepcion = ctx.overridePrecio != null;

  if (esExcepcion) {
    precioBase = ctx.overridePrecio;
    origen = "excepcion";
  } else if (sucursal.esCentral) {
    precioBase = ctx.precioBaseManual;
    origen = precioBase == null ? "sin_precio" : "manual";
  } else if (ctx.precioBaseManual != null) {
    const monto = ctx.recargoSkuMonto ?? ctx.recargoCategoriaMonto ?? 0;
    precioBase = ctx.precioBaseManual + monto * sku.unidadesContenidas;
    origen = "recargo";
  }

  // El override es la ultima palabra del dueño: no se le vuelve a aplicar
  // el descuento por efectivo encima.
  let precioEfectivo = precioBase;
  const precioOtroMedio = precioBase;
  if (!esExcepcion && precioBase != null && ctx.descuentoEfectivoPct != null) {
    precioEfectivo = precioBase * (1 - ctx.descuentoEfectivoPct / 100);
  }

  const costoReferencia = ctx.costoActualPropio;

  const bajoCostoEfectivo =
    precioEfectivo != null && costoReferencia != null && precioEfectivo < costoReferencia;
  const bajoCostoOtroMedio =
    precioOtroMedio != null && costoReferencia != null && precioOtroMedio < costoReferencia;

  return {
    origen,
    esExcepcion,
    precioBase,
    precioEfectivo,
    precioOtroMedio,
    bajoCostoEfectivo,
    bajoCostoOtroMedio,
    costoReferencia,
  };
}
