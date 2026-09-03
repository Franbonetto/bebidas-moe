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
    unidadVolumen: "ml" | "l";
    tipoPresentacion: "unidad" | "pack" | "cajon" | "estuche";
    unidadesContenidas: number;
    esRetornable: boolean;
    tipoEnvase: { id: string } | { nombreNueva: string; esGenerico: boolean; valorDeposito: number } | null;
    desarmaEnSkuId: string | null;
    desarmaEnCantidad: number | null;
    cascadaCervezaLata: boolean;
    stockMinimo: number;
    stockObjetivo: number;
  };
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
      cascada_cerveza_lata: input.sku.cascadaCervezaLata,
      stock_minimo: input.sku.stockMinimo,
      stock_objetivo: input.sku.stockObjetivo,
    })
    .select("id")
    .single();

  if (skuError) return { error: `No se pudo crear el SKU: ${skuError.message}` };

  revalidatePath("/productos");
  return { id: sku.id };
}
