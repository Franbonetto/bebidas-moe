"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type NuevoProductoInput = {
  producto: { id: string } | { nombreNuevo: string };
  // Solo se usan si producto es {nombreNuevo}. Un producto existente ya
  // tiene su marca/categoría fijadas.
  marca: { id: string } | { nombreNueva: string };
  categoria: { id: string } | { nombreNueva: string; categoriaPadreId: string | null };
  sku: {
    nombre: string;
    codigoInterno: string;
    codigoBarras: string | null;
    volumen: number;
    unidadVolumen: "ml" | "l" | "un" | "g";
    tipoPresentacion: "unidad" | "pack" | "cajon" | "estuche";
    unidadesContenidas: number;
    esRetornable: boolean;
    tipoEnvase: { id: string } | { nombreNueva: string; esGenerico: boolean; valorDeposito: number } | null;
    desarmaEnSkuId: string | null;
    desarmaEnCantidad: number | null;
    // Presentaciones que NO existen todavía y hay que crear acá mismo, de
    // afuera hacia adentro: para una cerveza que entra en x24 la cadena es
    // [pack x6, unidad]. Alternativa a desarmaEnSkuId, no se usan las dos
    // juntas -- pedido del usuario 2026-10-06: cargar la cascada entera en
    // una sola pantalla en vez de tres altas en orden inverso.
    desarmaCadena: SkuDerivado[];
    stockMinimo: number;
    stockObjetivo: number;
  };
  // proveedor_skus: opcional, uno o varios (arquitectura.md 1.6 — proveedor
  // asociado a un SKU especifico, no solo a traves de una compra puntual).
  proveedores: { proveedorId: string; costoReferencia: number | null }[];
};

// Una presentación creada al vuelo desde el desarme. Hereda del SKU
// principal lo que no cambia (producto, volumen, unidad) y solo pide lo que
// sí: qué es, cuántas unidades trae y con qué código se escanea.
export type SkuDerivado = {
  nombre: string;
  codigoBarras: string | null;
  tipoPresentacion: "unidad" | "pack" | "cajon" | "estuche";
  unidadesContenidas: number;
  // Cuántos de ESTA presentación produce desarmar una del nivel de arriba.
  // El x24 se desarma en 4 packs x6; el x6, en 6 unidades.
  factor: number;
};

// Inserta un SKU y traduce los choques de unicidad a algo que se entienda
// desde el mostrador. Lo usan tanto el SKU principal como las
// presentaciones que se crean en cascada desde el desarme.
async function insertarSku(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campos: Record<string, unknown>,
): Promise<{ error: string } | { id: string }> {
  const { data, error } = await supabase.from("skus").insert(campos).select("id").single();

  if (error) {
    if (error.code === "23505") {
      if (error.message.includes("codigo_barras"))
        return {
          error:
            "ese código de barras ya está asignado a otro producto. Escaneálo de nuevo, o buscá ese producto en el catálogo.",
        };
      return { error: "el código interno ya está usado." };
    }
    return { error: error.message };
  }

  return { id: data.id };
}

// Siguiente código interno libre, mirando solo los que son puramente
// numéricos (00001, 00002, ...). Los códigos "hablados" tipo BRANCA-750 se
// ignoran para esta cuenta: conviven sin molestar.
export async function siguienteCodigoInterno(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("skus").select("codigo_interno");

  const maximo = (data ?? []).reduce((acc, fila) => {
    const codigo = (fila.codigo_interno ?? "").trim();
    if (!/^\d+$/.test(codigo)) return acc;
    return Math.max(acc, Number(codigo));
  }, 0);

  return String(maximo + 1).padStart(5, "0");
}

export async function crearProductoYSku(
  input: NuevoProductoInput,
): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  let productoId: string;

  if ("id" in input.producto) {
    productoId = input.producto.id;
  } else {
    let marcaId: string;
    if ("id" in input.marca) {
      marcaId = input.marca.id;
    } else {
      const { data, error } = await supabase
        .from("marcas")
        .insert({ nombre: input.marca.nombreNueva })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505")
          return { error: "Ya existe una marca con ese nombre: elegila en \"Existente\"." };
        return { error: `No se pudo crear la marca: ${error.message}` };
      }
      marcaId = data.id;
    }

    let categoriaId: string;
    if ("id" in input.categoria) {
      categoriaId = input.categoria.id;
    } else {
      const { data, error } = await supabase
        .from("categorias")
        .insert({
          nombre: input.categoria.nombreNueva,
          categoria_padre_id: input.categoria.categoriaPadreId,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505")
          return { error: "Ya existe una categoría con ese nombre: elegila en \"Existente\"." };
        return { error: `No se pudo crear la categoría: ${error.message}` };
      }
      categoriaId = data.id;
    }

    const { data, error } = await supabase
      .from("productos")
      .insert({ nombre: input.producto.nombreNuevo, marca_id: marcaId, categoria_id: categoriaId })
      .select("id")
      .single();
    // 23505 = unique_violation. El caso real: ese producto ya existe para
    // esa marca (productos_marca_id_nombre_key) y la persona lo está
    // volviendo a crear en vez de elegirlo de la lista -- pasa seguido
    // cargando catálogo, y el mensaje de Postgres no ayuda a entenderlo.
    if (error) {
      if (error.code === "23505")
        return {
          error:
            "Ya existe un producto con ese nombre para esa marca. Elegilo en \"Existente\" en vez de crearlo: ahí le agregás esta presentación.",
        };
      return { error: `No se pudo crear el producto: ${error.message}` };
    }
    productoId = data.id;
  }

  let tipoEnvaseId: string | null = null;
  if (input.sku.esRetornable) {
    const tipoEnvase = input.sku.tipoEnvase;
    if (!tipoEnvase) return { error: "Falta el tipo de envase." };
    if ("id" in tipoEnvase) {
      tipoEnvaseId = tipoEnvase.id;
    } else {
      const { data, error } = await supabase
        .from("tipos_envase")
        .insert({
          nombre: tipoEnvase.nombreNueva,
          es_generico: tipoEnvase.esGenerico,
          valor_deposito: tipoEnvase.valorDeposito,
        })
        .select("id")
        .single();
      if (error) return { error: `No se pudo crear el tipo de envase: ${error.message}` };
      tipoEnvaseId = data.id;
    }
  }

  // Las presentaciones del desarme se crean de adentro hacia afuera: el x24
  // necesita que el x6 ya exista para poder apuntarle, y el x6 lo mismo con
  // la unidad. Por eso la cadena (que llega de afuera hacia adentro) se
  // recorre al revés.
  //
  // Si algo falla a mitad de camino se borran las que se acaban de crear:
  // son SKU recién nacidos, sin movimientos ni precios, así que borrarlos es
  // limpio. supabase-js no da transacciones entre inserts, y dejar media
  // cascada cargada es peor que no cargar nada.
  const creadosEnCascada: string[] = [];

  async function deshacerCascada() {
    if (creadosEnCascada.length > 0) {
      await supabase.from("skus").delete().in("id", creadosEnCascada);
    }
  }

  let desarmaEnSkuId = input.sku.desarmaEnSkuId;
  let desarmaEnCantidad = input.sku.desarmaEnCantidad;

  for (const derivado of [...input.sku.desarmaCadena].reverse()) {
    const resultado = await insertarSku(supabase, {
      producto_id: productoId,
      nombre: derivado.nombre,
      codigo_interno: await siguienteCodigoInterno(),
      codigo_barras: derivado.codigoBarras,
      // Lo que no cambia entre presentaciones del mismo producto: el
      // contenido de cada envase es el mismo (una lata de 354 ml sigue
      // siendo de 354 ml esté suelta o en un pack).
      volumen: input.sku.volumen,
      unidad_volumen: input.sku.unidadVolumen,
      tipo_presentacion: derivado.tipoPresentacion,
      unidades_contenidas: derivado.unidadesContenidas,
      // El envase retornable se carga después editando el SKU: meterlo acá
      // convertía el bloque chico en otro formulario completo.
      es_retornable: false,
      tipo_envase_id: null,
      // La de más adentro no se desarma en nada; las otras apuntan a la que
      // se acaba de crear en la vuelta anterior.
      desarma_en_sku_id: desarmaEnSkuId,
      desarma_en_cantidad: desarmaEnSkuId ? desarmaEnCantidad : null,
      // Se cargan después, al contar (Carga inicial).
      stock_minimo: 0,
      stock_objetivo: 0,
    });

    if ("error" in resultado) {
      await deshacerCascada();
      return { error: `No se pudo crear "${derivado.nombre}": ${resultado.error}` };
    }

    creadosEnCascada.push(resultado.id);
    desarmaEnSkuId = resultado.id;
    desarmaEnCantidad = derivado.factor;
  }

  // Si el código interno que vino es puramente numérico y está ocupado, se
  // avanza al siguiente libre en vez de hacerle perder el intento: es un
  // identificador interno que nadie memoriza, y el choque pasa siempre que
  // se cargan varios productos seguidos sin recargar la pantalla. Un código
  // "hablado" (BRANCA-750) sí es una decisión de la persona: ese no se
  // toca, se avisa.
  let codigoInterno = input.sku.codigoInterno;
  if (/^\d+$/.test(codigoInterno)) {
    const { data: ocupado } = await supabase
      .from("skus")
      .select("id")
      .eq("codigo_interno", codigoInterno)
      .maybeSingle();
    if (ocupado) codigoInterno = await siguienteCodigoInterno();
  }

  const { data: sku, error: skuError } = await supabase
    .from("skus")
    .insert({
      producto_id: productoId,
      nombre: input.sku.nombre,
      codigo_interno: codigoInterno,
      codigo_barras: input.sku.codigoBarras,
      volumen: input.sku.volumen,
      unidad_volumen: input.sku.unidadVolumen,
      tipo_presentacion: input.sku.tipoPresentacion,
      unidades_contenidas: input.sku.unidadesContenidas,
      es_retornable: input.sku.esRetornable,
      tipo_envase_id: input.sku.esRetornable ? tipoEnvaseId : null,
      desarma_en_sku_id: desarmaEnSkuId,
      desarma_en_cantidad: desarmaEnSkuId ? desarmaEnCantidad : null,
      stock_minimo: input.sku.stockMinimo,
      stock_objetivo: input.sku.stockObjetivo,
    })
    .select("id")
    .single();

  if (skuError) {
    await deshacerCascada();
    // El mensaje de Postgres trae el nombre de la constraint: sirve para
    // decir CUÁL de los dos códigos choca, que era justo lo que faltaba.
    if (skuError.code === "23505") {
      if (skuError.message.includes("codigo_barras"))
        return {
          error:
            "Ese código de barras ya está asignado a otro producto. Escaneálo de nuevo, o buscá ese producto en el catálogo.",
        };
      return {
        error: `El código interno "${codigoInterno}" ya está usado. Poné otro (o dejá que el sistema lo numere solo).`,
      };
    }
    return { error: `No se pudo crear el SKU: ${skuError.message}` };
  }

  if (input.proveedores.length > 0) {
    const { error: proveedorSkusError } = await supabase.from("proveedor_skus").insert(
      input.proveedores.map((p) => ({
        sku_id: sku.id,
        proveedor_id: p.proveedorId,
        costo_referencia: p.costoReferencia,
      })),
    );
    if (proveedorSkusError)
      return {
        error: `El SKU se creó, pero no se pudo asociar el proveedor: ${proveedorSkusError.message}`,
      };
  }

  revalidatePath("/productos");
  return { id: sku.id };
}

// Asignar código de barras a un SKU que ya existe (alta progresiva,
// arquitectura.md 1.9: "puede hacerse progresivamente, los más vendidos
// primero"). Pensado para usarse desde el buscador de Cargar mercadería:
// se escanea un código que no matchea ningún SKU, se busca el producto por
// nombre y se le asigna ahí mismo, sin salir de la pantalla. RLS exige
// ve_costos() para el update igual que crearProductoYSku(); codigo_barras
// es unique, así que un código repetido vuelve como error legible.
export async function actualizarCodigoBarras(
  skuId: string,
  codigoBarras: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const codigo = codigoBarras.trim();
  if (!codigo) return { error: "El código de barras no puede estar vacío." };

  const { error } = await supabase.from("skus").update({ codigo_barras: codigo }).eq("id", skuId);

  if (error) {
    if (error.code === "23505") return { error: "Ese código de barras ya está asignado a otro producto." };
    return { error: error.message };
  }

  revalidatePath("/productos");
  revalidatePath("/compras");
  revalidatePath("/vender");
  revalidatePath("/envios");
  return { ok: true };
}

export type MovimientoSku = {
  id: string;
  tipo: string;
  cantidad: number;
  stock_anterior: number;
  stock_posterior: number;
  fecha: string;
  motivo: string | null;
  usuario: { nombre: string } | null;
  sucursal: { nombre: string } | null;
};

// Historial de movimientos de un SKU puntual, para el drill-down que
// reemplazó a la pantalla de "Stock" separada (se unificó en Productos:
// el catálogo ya tiene el stock actual, esto agrega el histórico sin
// duplicar una tabla aparte). movimientos_stock es de solo lectura para
// cualquier usuario activo (RLS, bloque 3) -- no hace falta filtrar por rol.
export async function obtenerMovimientosSku(
  skuId: string,
): Promise<{ error: string } | { movimientos: MovimientoSku[] }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("movimientos_stock")
    .select(
      "id, tipo, cantidad, stock_anterior, stock_posterior, fecha, motivo, usuario:usuarios ( nombre ), sucursal:sucursales ( nombre )",
    )
    .eq("sku_id", skuId)
    .order("fecha", { ascending: false })
    .limit(50);

  if (error) return { error: error.message };
  return { movimientos: (data ?? []) as unknown as MovimientoSku[] };
}

// Sacar un SKU del catálogo (duplicados cargados por error, típico durante
// la carga inicial -- pedido del usuario 2026-09-30).
//
// Dos comportamientos, según si el SKU tiene historia:
//
//   - SIN historia (recién creado, nunca se movió): se borra de verdad,
//     junto con su configuración (precio, recargo, proveedor, la fila en
//     cero de stock). Es un error de tipeo, no tiene sentido dejarlo.
//   - CON historia (se vendió, se compró, se contó en un inventario, se le
//     registró una merma): NO se borra. Se da de baja (activo = false):
//     desaparece del catálogo, del buscador y del POS, pero los movimientos
//     y las ventas siguen apuntando a algo que existe. Borrarlo sería
//     romper la trazabilidad, que es la regla 2 de CLAUDE.md.
//
// Si aparece una relación que no está en la lista de abajo, el borrado
// falla con 23503 y se cae igual a dar de baja: nunca queda a medias.
export async function eliminarSku(
  skuId: string,
): Promise<{ error: string } | { eliminado: true } | { desactivado: true }> {
  const supabase = await createClient();

  const tablasConHistoria = [
    "movimientos_stock",
    "venta_items",
    "compra_items",
    "recepcion_items",
    "historial_costos",
    "inventario_items",
    "mermas",
    "pedido_items",
    "pedidos_compra_items",
    "transferencia_items",
  ] as const;

  const conteos = await Promise.all(
    tablasConHistoria.map((tabla) =>
      supabase.from(tabla).select("sku_id", { count: "exact", head: true }).eq("sku_id", skuId),
    ),
  );

  const tieneHistoria = conteos.some((r) => (r.count ?? 0) > 0);

  async function darDeBaja(): Promise<{ error: string } | { desactivado: true }> {
    const { error } = await supabase.from("skus").update({ activo: false }).eq("id", skuId);
    if (error) return { error: error.message };
    revalidatePath("/productos");
    revalidatePath("/vender");
    return { desactivado: true };
  }

  if (tieneHistoria) return darDeBaja();

  // Configuración: no es historia, se va con el SKU.
  for (const tabla of ["precios", "precios_sucursal", "recargos_sku", "proveedor_skus", "stock_sucursal"] as const) {
    await supabase.from(tabla).delete().eq("sku_id", skuId);
  }

  const { error } = await supabase.from("skus").delete().eq("id", skuId);

  if (error) {
    // 23503 = foreign_key_violation: algo más lo referencia (una promoción,
    // otro SKU que se desarma en este). Se da de baja en vez de fallar.
    if (error.code === "23503") return darDeBaja();
    return { error: error.message };
  }

  revalidatePath("/productos");
  revalidatePath("/vender");
  return { eliminado: true };
}

export type EditarSkuCompletoInput = {
  // El producto se edita desde la presentación, pero NO se arrastra a las
  // hermanas (pedido del usuario 2026-10-08: "cada producto se edita por
  // separado"). Si este SKU comparte producto con otras presentaciones y acá
  // se cambia el nombre, la marca o la categoría, esta presentación se
  // separa en un producto propio y las otras quedan como estaban.
  producto: {
    nombre: string;
    marca: { id: string } | { nombreNueva: string };
    categoria: { id: string } | { nombreNueva: string; categoriaPadreId: string | null };
  };
  sku: {
    nombre: string;
    codigoInterno: string;
    codigoBarras: string | null;
    volumen: number;
    unidadVolumen: "ml" | "l" | "un" | "g";
    tipoPresentacion: "unidad" | "pack" | "cajon" | "estuche";
    unidadesContenidas: number;
    esRetornable: boolean;
    tipoEnvase: { id: string } | { nombreNueva: string; esGenerico: boolean; valorDeposito: number } | null;
    desarmaEnSkuId: string | null;
    desarmaEnCantidad: number | null;
    stockMinimo: number;
    stockObjetivo: number;
  };
  proveedores: { proveedorId: string; costoReferencia: number | null }[];
};

// Editar una presentación ya cargada, con el mismo formulario del alta
// (pedido del usuario 2026-10-08: el cuadrito de nombre y presentación se
// quedaba corto).
//
// No toca stock (solo se mueve con un movimiento, regla 1), ni costo (lo
// pone la recepción de una compra), ni precio (eso es Precios / Carga
// inicial). Esta pantalla es catálogo: qué es el producto, no cuánto hay ni
// cuánto sale.
export async function editarSkuCompleto(
  skuId: string,
  input: EditarSkuCompletoInput,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const nombreProducto = input.producto.nombre.trim();
  if (!nombreProducto) return { error: "El nombre del producto no puede estar vacío." };
  if (!input.sku.nombre.trim()) return { error: "El nombre de la presentación no puede estar vacío." };
  if (!Number.isFinite(input.sku.volumen) || input.sku.volumen <= 0)
    return { error: "El volumen tiene que ser mayor a cero." };
  if (!Number.isInteger(input.sku.unidadesContenidas) || input.sku.unidadesContenidas <= 0)
    return { error: "Las unidades contenidas tienen que ser un entero mayor a cero." };

  const { data: skuActual, error: errorActual } = await supabase
    .from("skus")
    .select("producto_id, producto:productos ( nombre, marca_id, categoria_id )")
    .eq("id", skuId)
    .single();

  if (errorActual) return { error: errorActual.message };

  const productoActual = skuActual.producto as unknown as {
    nombre: string;
    marca_id: string;
    categoria_id: string;
  } | null;

  // --- marca y categoría destino -------------------------------------
  let marcaId: string;
  if ("id" in input.producto.marca) {
    marcaId = input.producto.marca.id;
  } else {
    const { data, error } = await supabase
      .from("marcas")
      .insert({ nombre: input.producto.marca.nombreNueva.trim() })
      .select("id")
      .single();
    if (error) return { error: "No se pudo crear la marca: " + error.message };
    marcaId = data.id;
  }

  let categoriaId: string;
  if ("id" in input.producto.categoria) {
    categoriaId = input.producto.categoria.id;
  } else {
    const { data, error } = await supabase
      .from("categorias")
      .insert({
        nombre: input.producto.categoria.nombreNueva.trim(),
        categoria_padre_id: input.producto.categoria.categoriaPadreId,
      })
      .select("id")
      .single();
    if (error) return { error: "No se pudo crear la categoría: " + error.message };
    categoriaId = data.id;
  }

  // --- ¿cambió algo del producto? ------------------------------------
  const cambioProducto =
    productoActual != null &&
    (productoActual.nombre !== nombreProducto ||
      productoActual.marca_id !== marcaId ||
      productoActual.categoria_id !== categoriaId);

  let productoId = skuActual.producto_id;

  if (cambioProducto) {
    const { count: hermanas } = await supabase
      .from("skus")
      .select("id", { count: "exact", head: true })
      .eq("producto_id", skuActual.producto_id)
      .neq("id", skuId);

    if ((hermanas ?? 0) === 0) {
      // Es la única presentación: se edita el producto en el lugar.
      const { error } = await supabase
        .from("productos")
        .update({ nombre: nombreProducto, marca_id: marcaId, categoria_id: categoriaId })
        .eq("id", productoId);
      if (error) {
        if (error.code === "23505")
          return { error: "Esa marca ya tiene otro producto con ese nombre." };
        return { error: "No se pudo guardar el producto: " + error.message };
      }
    } else {
      // Tiene hermanas: se separa en un producto propio, para no cambiarles
      // el nombre a ellas también. Si ya existe uno con esa marca y ese
      // nombre, se cuelga de ese en vez de duplicarlo.
      const { data: existente } = await supabase
        .from("productos")
        .select("id")
        .eq("marca_id", marcaId)
        .eq("nombre", nombreProducto)
        .maybeSingle();

      if (existente) {
        productoId = existente.id;
      } else {
        const { data, error } = await supabase
          .from("productos")
          .insert({ nombre: nombreProducto, marca_id: marcaId, categoria_id: categoriaId })
          .select("id")
          .single();
        if (error) return { error: "No se pudo separar el producto: " + error.message };
        productoId = data.id;
      }
    }
  }

  // --- tipo de envase ------------------------------------------------
  let tipoEnvaseId: string | null = null;
  if (input.sku.esRetornable) {
    const tipoEnvase = input.sku.tipoEnvase;
    if (!tipoEnvase) return { error: "Falta el tipo de envase." };
    if ("id" in tipoEnvase) {
      tipoEnvaseId = tipoEnvase.id;
    } else {
      const { data, error } = await supabase
        .from("tipos_envase")
        .insert({
          nombre: tipoEnvase.nombreNueva,
          es_generico: tipoEnvase.esGenerico,
          valor_deposito: tipoEnvase.valorDeposito,
        })
        .select("id")
        .single();
      if (error) return { error: "No se pudo crear el tipo de envase: " + error.message };
      tipoEnvaseId = data.id;
    }
  }

  // --- el SKU --------------------------------------------------------
  const { error: errorSku } = await supabase
    .from("skus")
    .update({
      producto_id: productoId,
      nombre: input.sku.nombre.trim(),
      codigo_interno: input.sku.codigoInterno.trim(),
      codigo_barras: input.sku.codigoBarras,
      volumen: input.sku.volumen,
      unidad_volumen: input.sku.unidadVolumen,
      tipo_presentacion: input.sku.tipoPresentacion,
      unidades_contenidas: input.sku.unidadesContenidas,
      es_retornable: input.sku.esRetornable,
      tipo_envase_id: input.sku.esRetornable ? tipoEnvaseId : null,
      desarma_en_sku_id: input.sku.desarmaEnSkuId,
      desarma_en_cantidad: input.sku.desarmaEnSkuId ? input.sku.desarmaEnCantidad : null,
      stock_minimo: input.sku.stockMinimo,
      stock_objetivo: input.sku.stockObjetivo,
    })
    .eq("id", skuId);

  if (errorSku) {
    if (errorSku.code === "23505") {
      if (errorSku.message.includes("codigo_barras"))
        return { error: "Ese código de barras ya está asignado a otro producto." };
      return { error: "Ese código interno ya está usado por otro producto." };
    }
    return { error: "No se pudo guardar la presentación: " + errorSku.message };
  }

  // --- proveedores ---------------------------------------------------
  // Se reemplaza la lista entera: proveedor_skus es configuración, no
  // historia (el costo de cada compra vive en historial_costos).
  const { error: errorBorrado } = await supabase.from("proveedor_skus").delete().eq("sku_id", skuId);
  if (errorBorrado)
    return {
      error:
        "La presentación se guardó, pero no se pudieron actualizar los proveedores: " +
        errorBorrado.message,
    };

  if (input.proveedores.length > 0) {
    const { error } = await supabase.from("proveedor_skus").insert(
      input.proveedores.map((p) => ({
        sku_id: skuId,
        proveedor_id: p.proveedorId,
        costo_referencia: p.costoReferencia,
      })),
    );
    if (error)
      return {
        error: "La presentación se guardó, pero no se pudo asociar el proveedor: " + error.message,
      };
  }

  revalidatePath("/productos");
  revalidatePath("/precios");
  revalidatePath("/vender");
  revalidatePath("/compras");
  return { ok: true };
}
