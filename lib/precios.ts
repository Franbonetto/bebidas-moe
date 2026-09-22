// Calculo de precios de venta. Deliberadamente NO vive en la base de datos:
// el precio se resuelve al vuelo a partir de costo_actual + las tablas de
// recargo/descuento (ver supabase/migrations/20260901120000_bloque5_precios.sql),
// nunca se guarda ni se cachea. Asi evitamos el problema de precios
// desactualizados cuando entra una compra nueva y costo_actual cambia.
//
// Pensado para reusarse tal cual desde el POS (bloque 6) ademas de la
// pantalla de Precios: por eso no depende de nada de React/Next.

export type RolCascadaCerveza = "x24" | "x6" | "unidad";

export function rolCascadaCerveza(unidadesContenidas: number): RolCascadaCerveza | null {
  if (unidadesContenidas === 24) return "x24";
  if (unidadesContenidas === 6) return "x6";
  if (unidadesContenidas === 1) return "unidad";
  return null;
}

export type CascadaCerveza = {
  x24Olavarria: number;
  x6Olavarria: number;
  unidadOlavarria: number;
  x24Laprida: number;
  x6Laprida: number;
  unidadLaprida: number;
};

// Redondea hacia arriba al proximo multiplo de `paso` (ej. 2483 -> 2500,
// 2510 -> 2550 con paso=50).
function redondearArribaMultiplo(valor: number, paso: number): number {
  return Math.ceil(valor / paso) * paso;
}

// Cascada real confirmada por el cliente (bloque 5, corregida 2026-09-22:
// la base es el PRECIO DE VENTA que la encargada carga a mano para el x24
// al recibir la mercadería -- no un costo×1,20 automático):
//
// Olavarria (baja desde el precio de venta cargado a mano para el x24):
//   x24    = precio de venta cargado para el pack x24
//   x6     = precio_x24 / 4 + 1000
//   unidad = ceil((precio_x6 + 300) / 6)              -- redondeo a peso entero
//
// Laprida (parte del x6/x24 de Olavarria, NO usa el recargo por categoria):
//   x6     = precio_x6 Olavarria + 1000
//   x24    = precio_x24 Olavarria + 1000
//   unidad = redondear hacia arriba a multiplo de 50 de (precio_x6 Laprida / 6)
export function calcularCascadaCerveza(precioVentaX24: number): CascadaCerveza {
  const x24Olavarria = precioVentaX24;
  const x6Olavarria = x24Olavarria / 4 + 1000;
  const unidadOlavarria = Math.ceil((x6Olavarria + 300) / 6);

  const x6Laprida = x6Olavarria + 1000;
  const x24Laprida = x24Olavarria + 1000;
  const unidadLaprida = redondearArribaMultiplo(x6Laprida / 6, 50);

  return { x24Olavarria, x6Olavarria, unidadOlavarria, x24Laprida, x6Laprida, unidadLaprida };
}

function precioCascadaPara(
  cascada: CascadaCerveza,
  rol: RolCascadaCerveza,
  esCentral: boolean,
): number {
  if (esCentral) {
    if (rol === "x24") return cascada.x24Olavarria;
    if (rol === "x6") return cascada.x6Olavarria;
    return cascada.unidadOlavarria;
  }
  if (rol === "x24") return cascada.x24Laprida;
  if (rol === "x6") return cascada.x6Laprida;
  return cascada.unidadLaprida;
}

export type SkuParaPrecio = {
  id: string;
  categoriaId: string;
  unidadesContenidas: number;
  cascadaCervezaLata: boolean;
};

export type SucursalParaPrecio = {
  id: string;
  esCentral: boolean;
};

export type ContextoPrecio = {
  // costo_actual del propio SKU (skus.costo_actual). Null si nunca se
  // recibio una compra de este SKU puntual.
  costoActualPropio: number | null;
  // costo_actual del SKU x24 de la misma familia de cascada. Solo se usa
  // para el aviso de "precio por debajo del costo" (costoReferencia mas
  // abajo) -- el precio en si ya NO se calcula del costo, ver
  // precioVentaX24Familia.
  costoActualX24Familia: number | null;
  // precios.precio_base cargado a mano para el SKU x24 de la misma familia
  // de cascada (2026-09-22: la base de la cascada es el precio de venta
  // que la encargada carga al recibir el x24, no un costo x1.20
  // automatico). Solo aplica a SKU con cascadaCervezaLata = true; en los
  // demas, null.
  precioVentaX24Familia: number | null;
  // precios_sucursal.precio_override para (sucursal, sku), si existe.
  overridePrecio: number | null;
  // precios.precio_base (manual, solo tiene sentido para SKU sin cascada).
  precioBaseManual: number | null;
  // recargos_sku.monto_fijo para (sucursal, sku), si existe.
  recargoSkuMonto: number | null;
  // recargos_sucursal.monto_fijo para (sucursal, categoria del producto).
  recargoCategoriaMonto: number | null;
  // descuentos_efectivo.porcentaje para (sucursal, categoria), si existe.
  descuentoEfectivoPct: number | null;
};

export type Origen = "excepcion" | "cascada" | "manual" | "recargo" | "sin_precio" | "sin_costo";

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
  } else if (sku.cascadaCervezaLata) {
    if (ctx.precioVentaX24Familia == null) {
      origen = "sin_precio";
    } else {
      const rol = rolCascadaCerveza(sku.unidadesContenidas);
      if (rol) {
        const cascada = calcularCascadaCerveza(ctx.precioVentaX24Familia);
        precioBase = precioCascadaPara(cascada, rol, sucursal.esCentral);
        origen = "cascada";
      }
    }
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

  const costoReferencia = sku.cascadaCervezaLata
    ? ctx.costoActualX24Familia == null
      ? null
      : (ctx.costoActualX24Familia * sku.unidadesContenidas) / 24
    : ctx.costoActualPropio;

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
