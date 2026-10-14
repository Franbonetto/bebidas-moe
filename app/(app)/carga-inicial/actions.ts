"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  guardarPrecioBase,
  guardarOverride,
  eliminarOverride,
  guardarPrecioEfectivo,
  eliminarPrecioEfectivo,
  guardarPromoCantidadSku,
  promoCantidadDeSku,
} from "@/app/(app)/precios/actions";
import { presentacionLabel } from "@/app/(app)/productos/_lib/presentacion";

export type PromoCantidadCarga = {
  // Cuántas unidades entran en la promo (2 en un 2x).
  cantidadRequerida: number;
  // Total que paga el cliente por esas unidades en la sucursal que se está
  // contando. null = la promo existe pero no corre acá.
  precioTotal: number | null;
  // El nombre con el que ya está cargada, que es el que sale en el ticket.
  nombre: string;
  activo: boolean;
};

export type DatosSkuCarga = {
  stockActual: number;
  costoActual: number | null;
  precioBase: number | null;
  codigoBarras: string | null;
  // Precio en efectivo propio de este SKU en la sucursal que se está
  // contando (precios_efectivo). null = no tiene uno y rige el descuento de
  // la categoría, si la categoría tiene uno.
  precioEfectivo: number | null;
  // Porcentaje de descuento por efectivo de la categoría en esta sucursal,
  // para poder mostrar cuánto se cobra hoy sin cargar nada.
  descuentoEfectivoPct: number | null;
  // Promo por cantidad (2x, 3x) de este SKU, si ya hay una.
  promoCantidad: PromoCantidadCarga | null;
  // Más de una promo por cantidad para el mismo SKU: no se toca desde acá,
  // hay que ir a Precios.
  promoVarias: boolean;
  // Proveedor ya asociado al SKU (proveedor_skus). Si tiene más de uno se
  // toma el primero solo para preseleccionarlo -- el resto no se toca.
  proveedorId: string | null;
  // Vencimiento del último lote cargado, para que se note si ya pasó por
  // este producto.
  vencimientoUltimoLote: string | null;
  // Umbrales de reposición del SKU: se cargan acá porque es el momento en
  // que tiene el producto delante y sabe cuánto le conviene tener.
  stockMinimo: number;
  stockObjetivo: number;
  // Precio de la sucursal satélite (Laprida). null si no hay ninguna
  // sucursal no central activa.
  laprida: PrecioLaprida | null;
};

export type PrecioLaprida = {
  sucursalId: string;
  nombre: string;
  // precio base + recargo de la categoría (o del SKU, si tiene uno propio)
  // × unidades contenidas. Es lo que rige hoy sin cargar nada. null si el
  // SKU todavía no tiene precio base.
  precioCalculado: number | null;
  // precios_sucursal.precio_override, si ya hay una excepción cargada.
  override: number | null;
  // Las dos piezas del cálculo, para que el formulario pueda recalcular el
  // sugerido en vivo mientras se tipea el precio base. Quién decide si se
  // guarda una excepción sigue siendo el servidor.
  recargoPorUnidad: number;
  unidadesContenidas: number;
};

// Lo que hace falta para calcular el precio de la sucursal satélite. Se
// resuelve acá, en el servidor, y no se le cree el número al formulario:
// el recargo lo puede haber cambiado otro desde Precios mientras este
// estaba contando.
async function contextoLaprida(
  supabase: Awaited<ReturnType<typeof createClient>>,
  skuId: string,
): Promise<{ sucursalId: string; nombre: string; montoPorUnidad: number; unidades: number } | null> {
  const { data: sucursal } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true)
    .eq("es_central", false)
    .limit(1)
    .maybeSingle();

  if (!sucursal) return null;

  const { data: sku } = await supabase
    .from("skus")
    .select("unidades_contenidas, producto:productos ( categoria_id )")
    .eq("id", skuId)
    .maybeSingle();

  if (!sku) return null;

  const categoriaId = (sku.producto as unknown as { categoria_id: string } | null)?.categoria_id;

  const [{ data: recargoSku }, { data: recargoCategoria }] = await Promise.all([
    supabase
      .from("recargos_sku")
      .select("monto_fijo")
      .eq("sucursal_id", sucursal.id)
      .eq("sku_id", skuId)
      .maybeSingle(),
    categoriaId
      ? supabase
          .from("recargos_sucursal")
          .select("monto_fijo")
          .eq("sucursal_id", sucursal.id)
          .eq("categoria_id", categoriaId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Mismo orden de prioridad que calcularPrecioVenta(): recargo propio del
  // SKU, si no el de la categoría, si no cero.
  const montoPorUnidad = recargoSku?.monto_fijo ?? recargoCategoria?.monto_fijo ?? 0;

  return {
    sucursalId: sucursal.id,
    nombre: sucursal.nombre,
    montoPorUnidad: Number(montoPorUnidad),
    unidades: sku.unidades_contenidas ?? 1,
  };
}

// Nombre de la promo cuando se crea desde acá. Es lo que se imprime en el
// ticket, así que tiene que leerse como lo diría la vendedora: "2x Abrasado
// Malbec · 750 ml". Si la promo ya existe no se toca -- se puede renombrar
// desde /precios.
async function nombrePromoSugerido(
  supabase: Awaited<ReturnType<typeof createClient>>,
  skuId: string,
  cantidad: number,
): Promise<string> {
  const { data: sku } = await supabase
    .from("skus")
    .select(
      `nombre, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
       producto:productos ( nombre, marca:marcas ( nombre ) )`,
    )
    .eq("id", skuId)
    .maybeSingle();

  if (!sku) return `${cantidad}x`;

  const producto = sku.producto as unknown as
    | { nombre: string; marca: { nombre: string } | null }
    | null;

  const partes = [producto?.marca?.nombre, producto?.nombre ?? sku.nombre].filter(Boolean);

  return `${cantidad}x ${partes.join(" ")} · ${presentacionLabel({
    tipo_presentacion: sku.tipo_presentacion,
    volumen: sku.volumen,
    unidad_volumen: sku.unidad_volumen,
    unidades_contenidas: sku.unidades_contenidas,
  })}`;
}

// Lo que hay que mostrarle antes de que escriba nada: cuánto tiene el
// sistema hoy (para que se dé cuenta si ya pasó por ese producto), el costo
// y el precio ya cargados.
export async function datosSkuParaCarga(
  skuId: string,
  sucursalId: string,
): Promise<{ error: string } | DatosSkuCarga> {
  const supabase = await createClient();

  const [
    { data: sku, error: errorSku },
    { data: stock },
    { data: precio },
    { data: proveedorSku },
    { data: lote },
    { data: precioEfectivo },
    promo,
  ] = await Promise.all([
    supabase
      .from("skus")
      .select("costo_actual, codigo_barras, stock_minimo, stock_objetivo, producto:productos ( categoria_id )")
      .eq("id", skuId)
      .maybeSingle(),
    supabase
      .from("stock_sucursal")
      .select("cantidad")
      .eq("sku_id", skuId)
      .eq("sucursal_id", sucursalId)
      .maybeSingle(),
    supabase.from("precios").select("precio_base").eq("sku_id", skuId).maybeSingle(),
    supabase
      .from("proveedor_skus")
      .select("proveedor_id")
      .eq("sku_id", skuId)
      .eq("activo", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("historial_costos")
      .select("fecha_vencimiento")
      .eq("sku_id", skuId)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("precios_efectivo")
      .select("precio_efectivo")
      .eq("sucursal_id", sucursalId)
      .eq("sku_id", skuId)
      .maybeSingle(),
    promoCantidadDeSku(skuId, sucursalId),
  ]);

  if (errorSku) return { error: errorSku.message };
  if (!sku) return { error: "No encontramos ese producto." };

  // El descuento por efectivo de la categoría: es el que rige mientras el
  // SKU no tenga un precio en efectivo propio.
  const categoriaIdSku = (sku.producto as unknown as { categoria_id: string } | null)?.categoria_id;
  const { data: descuentoCategoria } = categoriaIdSku
    ? await supabase
        .from("descuentos_efectivo")
        .select("porcentaje")
        .eq("sucursal_id", sucursalId)
        .eq("categoria_id", categoriaIdSku)
        .maybeSingle()
    : { data: null };

  const ctxLaprida = await contextoLaprida(supabase, skuId);
  let laprida: PrecioLaprida | null = null;

  if (ctxLaprida) {
    const { data: override } = await supabase
      .from("precios_sucursal")
      .select("precio_override")
      .eq("sucursal_id", ctxLaprida.sucursalId)
      .eq("sku_id", skuId)
      .maybeSingle();

    const base = precio?.precio_base ?? null;
    laprida = {
      sucursalId: ctxLaprida.sucursalId,
      nombre: ctxLaprida.nombre,
      precioCalculado:
        base == null ? null : Number(base) + ctxLaprida.montoPorUnidad * ctxLaprida.unidades,
      override: override?.precio_override ?? null,
      recargoPorUnidad: ctxLaprida.montoPorUnidad,
      unidadesContenidas: ctxLaprida.unidades,
    };
  }

  return {
    stockActual: stock?.cantidad ?? 0,
    costoActual: sku.costo_actual ?? null,
    precioBase: precio?.precio_base ?? null,
    codigoBarras: sku.codigo_barras ?? null,
    precioEfectivo: precioEfectivo?.precio_efectivo ?? null,
    descuentoEfectivoPct: descuentoCategoria?.porcentaje ?? null,
    promoCantidad:
      "error" in promo || !promo.promo
        ? null
        : {
            cantidadRequerida: promo.promo.cantidadRequerida,
            precioTotal: promo.promo.precioTotal,
            nombre: promo.promo.nombre,
            activo: promo.promo.activo,
          },
    promoVarias: "error" in promo ? false : promo.varias,
    proveedorId: proveedorSku?.proveedor_id ?? null,
    vencimientoUltimoLote: lote?.fecha_vencimiento ?? null,
    stockMinimo: sku.stock_minimo ?? 0,
    stockObjetivo: sku.stock_objetivo ?? 0,
    laprida,
  };
}

// La cantidad es el TOTAL contado en esa sucursal, no un incremento:
// cargar_stock_inicial() registra como ajuste la diferencia contra lo que
// había. Cargar dos veces el mismo producto corrige, no duplica.
export async function guardarCargaInicial(datos: {
  sku_id: string;
  sucursal_id: string;
  cantidad: number;
  costo: number | null;
  precio: number | null;
  // Precio final en la sucursal satélite. null = sin excepción, Laprida
  // sigue el recargo de la categoría. Si el número coincide con el
  // calculado tampoco se guarda nada: no tiene sentido congelar un SKU en
  // el valor que la regla ya le da.
  precio_laprida: number | null;
  // Precio en efectivo propio de este SKU en la sucursal que se está
  // contando. null = sin precio propio, vuelve a regir el descuento de la
  // categoría (y se borra el que hubiera).
  precio_efectivo: number | null;
  // Promo por cantidad (2x, 3x) para la sucursal que se está contando.
  // null = este producto no tiene promo acá (si tenía, se la saca).
  // Ausente = no se toca la promo, pase lo que pase: es lo que manda el
  // formulario cuando el SKU tiene más de una promo por cantidad cargada y
  // no corresponde que carga inicial elija una.
  promo_cantidad?: { cantidad: number; precio_total: number } | null;
  // Un lote por fecha de vencimiento. Vacío = no se cargó vencimiento.
  // Cuando hay más de uno, las cantidades tienen que sumar lo contado: un
  // producto puede tener 6 que vencen en marzo y 6 en septiembre.
  lotes: { cantidad: number; fecha_vencimiento: string }[];
  proveedor_id: string | null;
  // null = no lo tocó, se deja el que ya tenía el SKU.
  stock_minimo: number | null;
  stock_objetivo: number | null;
}): Promise<{ error: string } | { stock: number }> {
  const supabase = await createClient();

  if (!Number.isInteger(datos.cantidad) || datos.cantidad < 0)
    return { error: "La cantidad contada tiene que ser un número entero, cero o más." };
  if (datos.costo !== null && datos.costo < 0) return { error: "El costo no puede ser negativo." };
  if (datos.precio_efectivo !== null && datos.precio_efectivo < 0)
    return { error: "El precio en efectivo no puede ser negativo." };
  if (datos.promo_cantidad) {
    if (!Number.isInteger(datos.promo_cantidad.cantidad) || datos.promo_cantidad.cantidad < 2)
      return { error: "La promo por cantidad arranca en 2 unidades (2x, 3x...)." };
    if (datos.promo_cantidad.precio_total < 0)
      return { error: "El total de la promo no puede ser negativo." };
  }

  for (const [valor, nombre] of [
    [datos.stock_minimo, "El stock mínimo"],
    [datos.stock_objetivo, "El stock objetivo"],
  ] as const) {
    if (valor !== null && (!Number.isInteger(valor) || valor < 0))
      return { error: `${nombre} tiene que ser un número entero, cero o más.` };
  }

  const sumaLotes = datos.lotes.reduce((acc, l) => acc + l.cantidad, 0);
  if (datos.lotes.length > 0) {
    for (const lote of datos.lotes) {
      if (!Number.isInteger(lote.cantidad) || lote.cantidad <= 0)
        return { error: "Cada vencimiento necesita una cantidad mayor a cero." };
      if (!lote.fecha_vencimiento) return { error: "Falta la fecha en uno de los vencimientos." };
    }
    if (sumaLotes !== datos.cantidad)
      return {
        error: `Los vencimientos suman ${sumaLotes} y contaste ${datos.cantidad}: tienen que dar igual.`,
      };
  }

  if (
    datos.stock_minimo !== null &&
    datos.stock_objetivo !== null &&
    datos.stock_objetivo > 0 &&
    datos.stock_objetivo < datos.stock_minimo
  )
    return {
      error: "El stock objetivo no puede ser menor que el mínimo: reponer te dejaría bajo el mínimo.",
    };

  // El precio primero: si falla, no queremos stock cargado con el precio a
  // medias. Al revés es peor -- el POS vende sin stock (advierte), pero sin
  // precio no puede vender.
  if (datos.precio !== null) {
    const resultadoPrecio = await guardarPrecioBase(datos.sku_id, datos.precio);
    if ("error" in resultadoPrecio) return { error: resultadoPrecio.error };
  }

  // El precio de Laprida va después del base, porque el calculado sale del
  // base recién guardado. Solo se escribe una excepción si el número
  // difiere del que la regla de la categoría ya le da: si coincide (o si
  // el campo quedó vacío), se borra cualquier excepción vieja y el SKU
  // vuelve a seguir el recargo. Así contar no convierte el catálogo entero
  // en 722 precios a mantener a mano.
  const { data: filaPrecio } = await supabase
    .from("precios")
    .select("precio_base")
    .eq("sku_id", datos.sku_id)
    .maybeSingle();
  const precioBaseGuardado = filaPrecio?.precio_base ?? null;

  const ctxLaprida = await contextoLaprida(supabase, datos.sku_id);

  // Precio de lista en la sucursal que se está contando: en la central es
  // el precio base; en la satélite, la excepción si se cargó una y si no el
  // base más el recargo. Hace falta para no dejar guardar un precio en
  // efectivo o una promo por encima de él -- confirmar_venta() rechaza
  // cualquier línea con precio_unitario > precio_lista_unitario, así que un
  // número más alto no se "vende más caro": no se puede vender.
  const esLaSatelite = ctxLaprida != null && ctxLaprida.sucursalId === datos.sucursal_id;
  const lapridaCalculado =
    ctxLaprida == null || precioBaseGuardado == null
      ? null
      : Number(precioBaseGuardado) + ctxLaprida.montoPorUnidad * ctxLaprida.unidades;
  const listaEnSucursal = esLaSatelite
    ? (datos.precio_laprida ?? lapridaCalculado)
    : precioBaseGuardado == null
      ? null
      : Number(precioBaseGuardado);

  if (ctxLaprida) {
    const calculado = lapridaCalculado;

    const esElCalculado =
      datos.precio_laprida !== null &&
      calculado !== null &&
      Math.abs(datos.precio_laprida - calculado) < 0.005;

    const resultadoLaprida =
      datos.precio_laprida === null || esElCalculado
        ? await eliminarOverride(ctxLaprida.sucursalId, datos.sku_id)
        : await guardarOverride(ctxLaprida.sucursalId, datos.sku_id, datos.precio_laprida);

    if ("error" in resultadoLaprida)
      return { error: `No se pudo guardar el precio de ${ctxLaprida.nombre}: ${resultadoLaprida.error}` };
  }

  // Precio en efectivo del SKU, para la sucursal que se está contando
  // (20261014090000_precio_efectivo_sku.sql). Vacío = se borra el que
  // hubiera y el SKU vuelve al descuento de su categoría.
  if (datos.precio_efectivo !== null && precioBaseGuardado == null)
    return {
      error: "Para cargar un precio en efectivo hace falta el precio de venta: sin él el POS no puede cobrar con otro medio.",
    };

  if (
    datos.precio_efectivo !== null &&
    listaEnSucursal != null &&
    datos.precio_efectivo > listaEnSucursal + 0.005
  )
    return {
      error: `El precio en efectivo (${datos.precio_efectivo}) no puede ser mayor al de lista (${listaEnSucursal}): el POS no deja cerrar una venta por encima del precio de lista.`,
    };

  if (datos.promo_cantidad && listaEnSucursal != null) {
    const unitarioPromo = datos.promo_cantidad.precio_total / datos.promo_cantidad.cantidad;
    if (unitarioPromo > listaEnSucursal + 0.005)
      return {
        error: `En la promo cada unidad sale ${Math.round(unitarioPromo * 100) / 100} y el precio de lista es ${listaEnSucursal}: una promo más cara que el precio de lista no se puede vender.`,
      };
  }

  const resultadoEfectivo =
    datos.precio_efectivo === null
      ? await eliminarPrecioEfectivo(datos.sucursal_id, datos.sku_id)
      : await guardarPrecioEfectivo(datos.sucursal_id, datos.sku_id, datos.precio_efectivo);

  if ("error" in resultadoEfectivo)
    return { error: `No se pudo guardar el precio en efectivo: ${resultadoEfectivo.error}` };

  // Promo por cantidad (2x, 3x). Es una promoción común del bloque 6, no
  // algo propio de carga inicial: se guarda con la misma función que usa
  // /precios, y como todas las promos aplica solo en efectivo.
  if (datos.promo_cantidad !== undefined) {
    const resultadoPromo = await guardarPromoCantidadSku({
      skuId: datos.sku_id,
      sucursalId: datos.sucursal_id,
      cantidadRequerida: datos.promo_cantidad?.cantidad ?? 2,
      precioTotal: datos.promo_cantidad?.precio_total ?? null,
      // Solo hace falta si hay que crearla: si la promo ya existe se
      // respeta el nombre que tiene, porque es el que se imprime en el
      // ticket.
      nombreSugerido: datos.promo_cantidad
        ? await nombrePromoSugerido(supabase, datos.sku_id, datos.promo_cantidad.cantidad)
        : "",
    });

    if ("error" in resultadoPromo)
      return { error: `No se pudo guardar la promo: ${resultadoPromo.error}` };
  }

  const { data, error } = await supabase.rpc("cargar_stock_inicial", {
    p_sku_id: datos.sku_id,
    p_sucursal_id: datos.sucursal_id,
    p_cantidad: datos.cantidad,
    p_costo: datos.costo,
    p_proveedor_id: datos.proveedor_id,
    p_lotes: datos.lotes.length > 0 ? datos.lotes : null,
  });

  if (error) return { error: error.message };

  // Los umbrales viven en el catálogo (skus), no en el stock: van aparte, con
  // el update directo que ya usa el resto del catálogo (RLS ve_costos()).
  if (datos.stock_minimo !== null || datos.stock_objetivo !== null) {
    const cambios: { stock_minimo?: number; stock_objetivo?: number } = {};
    if (datos.stock_minimo !== null) cambios.stock_minimo = datos.stock_minimo;
    if (datos.stock_objetivo !== null) cambios.stock_objetivo = datos.stock_objetivo;

    const { error: errorUmbrales } = await supabase
      .from("skus")
      .update(cambios)
      .eq("id", datos.sku_id);

    if (errorUmbrales)
      return {
        error: `El stock quedó cargado, pero no se pudieron guardar los mínimos: ${errorUmbrales.message}`,
      };
  }

  revalidatePath("/productos");
  revalidatePath("/carga-inicial");
  revalidatePath("/precios");
  return { stock: (data as number) ?? datos.cantidad };
}
