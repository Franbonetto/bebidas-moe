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
    stockMinimo: number;
    stockObjetivo: number;
  };
  // proveedor_skus: opcional, uno o varios (arquitectura.md 1.6 — proveedor
  // asociado a un SKU especifico, no solo a traves de una compra puntual).
  proveedores: { proveedorId: string; costoReferencia: number | null }[];
};

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
      if (error) return { error: `No se pudo crear la marca: ${error.message}` };
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
      if (error) return { error: `No se pudo crear la categoría: ${error.message}` };
      categoriaId = data.id;
    }

    const { data, error } = await supabase
      .from("productos")
      .insert({ nombre: input.producto.nombreNuevo, marca_id: marcaId, categoria_id: categoriaId })
      .select("id")
      .single();
    if (error) return { error: `No se pudo crear el producto: ${error.message}` };
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

  const { data: sku, error: skuError } = await supabase
    .from("skus")
    .insert({
      producto_id: productoId,
      nombre: input.sku.nombre,
      codigo_interno: input.sku.codigoInterno,
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
    .select("id")
    .single();

  if (skuError) return { error: `No se pudo crear el SKU: ${skuError.message}` };

  if (input.proveedores.length > 0) {
    const { error: proveedorSkusError } = await supabase.from("proveedor_skus").insert(
      input.proveedores.map((p) => ({
        sku_id: sku.id,
        proveedor_id: p.proveedorId,
        costo_referencia: p.costoReferencia,
      })),
    );
    if (proveedorSkusError)
      return { error: `El SKU se creó, pero no se pudo asociar el proveedor: ${proveedorSkusError.message}` };
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
