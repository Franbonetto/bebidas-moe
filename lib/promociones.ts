// Motor de promociones del POS (bloque 6). Deliberadamente fuera de la base
// de datos, mismo criterio que lib/precios.ts: se resuelve al vuelo en la
// app a partir de las promociones activas + calcularPrecioVenta(). No
// depende de React, para poder testearlo y reusarlo tal cual en el ticket
// y en cualquier pantalla que necesite "cuánto sale este SKU ahora mismo".
//
// Prioridad (arquitectura.md 1.7): combo > cantidad > efectivo > base.
// Combo y cantidad SOLO aplican pagando en efectivo (billete en mano) --
// por eso este resolver asume que el ticket se va a pagar en efectivo; si
// el cliente termina pagando con otro medio, cada línea vuelve a su precio
// de lista sin pasar por este motor (ver PrecioVenta.precioOtroMedio).

export type LineaTicket = { skuId: string; cantidad: number };

// bajoCosto viene YA CALCULADO por el servidor (precio_promocional/cantidad
// vs. costoReferencia de ese SKU): el motor nunca recibe el costo en sí,
// solo el booleano. Así el bundle que le llega al encargado de Laprida no
// contiene el número aunque la UI nunca lo dibuje (arquitectura.md 1.7/1.11:
// "se advierte sin mostrarle el número del costo" -- si el número viaja en
// las props, un devtools alcanza para verlo igual).
export type ComboItemDef = {
  skuId: string;
  cantidadRequerida: number;
  precioPromocional: number;
  bajoCosto: boolean;
};
export type ComboDef = { id: string; nombre: string; prioridad: number; items: ComboItemDef[] };

export type PromoCantidadDef = {
  id: string;
  nombre: string;
  skuId: string;
  cantidadRequerida: number;
  precioPromocional: number;
  bajoCosto: boolean;
};

export type OrigenTramo = "combo" | "cantidad" | "excepcion" | "manual" | "recargo" | "sin_precio";

export type Tramo = {
  cantidad: number;
  precioUnitario: number;
  origen: OrigenTramo;
  promocionId: string | null;
  promocionNombre: string | null;
  bajoCosto: boolean;
};

export type BaseParaSku = {
  // calcularPrecioVenta(...).precioEfectivo (ya incluye recargo Laprida y
  // el descuento por efectivo de vinos, si corresponde), su origen, y el
  // booleano bajoCostoEfectivo que esa misma función ya calculaba.
  precioEfectivo: number | null;
  origen: OrigenTramo;
  bajoCosto: boolean;
};

// Resuelve, para cada SKU del ticket, en qué tramos se parte (arquitectura.md
// 1.7: gana UNA sola regla por unidad, no por línea completa). El orden de
// resolución es combo -> cantidad -> lo que quede va a precio base/efectivo.
export function resolverTicketEfectivo(
  lineas: LineaTicket[],
  combos: ComboDef[],
  promosCantidad: PromoCantidadDef[],
  obtenerBase: (skuId: string) => BaseParaSku,
): Map<string, Tramo[]> {
  const restante = new Map<string, number>();
  for (const l of lineas) restante.set(l.skuId, (restante.get(l.skuId) ?? 0) + l.cantidad);

  const resultado = new Map<string, Tramo[]>();
  for (const skuId of restante.keys()) resultado.set(skuId, []);

  function agregarTramo(skuId: string, tramo: Tramo) {
    const tramos = resultado.get(skuId);
    if (tramos) tramos.push(tramo);
    else resultado.set(skuId, [tramo]);
  }

  // 1. Combos, por prioridad (menor número = gana primero).
  const combosOrdenados = [...combos].sort((a, b) => a.prioridad - b.prioridad);
  for (const combo of combosOrdenados) {
    if (combo.items.length === 0) continue;

    let instancias = Infinity;
    for (const item of combo.items) {
      const disponible = restante.get(item.skuId) ?? 0;
      instancias = Math.min(instancias, Math.floor(disponible / item.cantidadRequerida));
    }
    if (!Number.isFinite(instancias) || instancias <= 0) continue;

    for (const item of combo.items) {
      const consumir = instancias * item.cantidadRequerida;
      restante.set(item.skuId, (restante.get(item.skuId) ?? 0) - consumir);

      agregarTramo(item.skuId, {
        cantidad: consumir,
        precioUnitario: item.precioPromocional / item.cantidadRequerida,
        origen: "combo",
        promocionId: combo.id,
        promocionNombre: combo.nombre,
        bajoCosto: item.bajoCosto,
      });
    }
  }

  // 2. Cantidad (2x, 3x...). Se agrupa en bloques de cantidadRequerida; lo
  // que no llega a formar un grupo completo queda para el paso 3.
  for (const promo of promosCantidad) {
    const disponible = restante.get(promo.skuId) ?? 0;
    const grupos = Math.floor(disponible / promo.cantidadRequerida);
    if (grupos <= 0) continue;

    const consumir = grupos * promo.cantidadRequerida;
    restante.set(promo.skuId, disponible - consumir);

    agregarTramo(promo.skuId, {
      cantidad: consumir,
      precioUnitario: promo.precioPromocional / promo.cantidadRequerida,
      origen: "cantidad",
      promocionId: promo.id,
      promocionNombre: promo.nombre,
      bajoCosto: promo.bajoCosto,
    });
  }

  // 3. Lo que queda de cada SKU, a precio base/efectivo.
  for (const [skuId, cantidad] of restante) {
    if (cantidad <= 0) continue;
    const base = obtenerBase(skuId);
    if (base.precioEfectivo == null) continue; // sin precio cargado: no se puede vender

    agregarTramo(skuId, {
      cantidad,
      precioUnitario: base.precioEfectivo,
      origen: base.origen,
      promocionId: null,
      promocionNombre: null,
      bajoCosto: base.bajoCosto,
    });
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Búsqueda por fragmentos: "jw dou" encuentra "Johnnie Walker Double Black".
// Cada término de la búsqueda tiene que aparecer como substring del nombre
// completo (cubre "dou" -> "double") O como una tanda de iniciales
// consecutivas de las palabras (cubre "jw" -> "Johnnie Walker").
// ---------------------------------------------------------------------------

const DIACRITICOS = new RegExp("[̀-ͯ]", "g");

function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICOS, "");
}

function tandasDeIniciales(palabras: string[]): Set<string> {
  const tandas = new Set<string>();
  for (let i = 0; i < palabras.length; i++) {
    let tanda = "";
    for (let j = i; j < palabras.length; j++) {
      tanda += palabras[j][0] ?? "";
      tandas.add(tanda);
    }
  }
  return tandas;
}

export function coincideFragmentos(textoCompleto: string, query: string): boolean {
  const q = normalizarTexto(query).trim();
  if (!q) return true;

  const haystack = normalizarTexto(textoCompleto);
  const palabras = haystack.split(/\s+/).filter(Boolean);
  const iniciales = tandasDeIniciales(palabras);

  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token) || iniciales.has(token));
}
