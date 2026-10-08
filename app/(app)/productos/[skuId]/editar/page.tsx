import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { veCostos } from "@/lib/permisos";
import {
  ProductoSkuForm,
  type MarcaOpcion,
  type CategoriaOpcion,
  type ProductoOpcion,
  type TipoEnvaseOpcion,
  type SkuOpcion,
  type ProveedorOpcion,
  type SkuParaEditar,
} from "../../nuevo/_components/producto-sku-form";

// Editar una presentación con el mismo formulario del alta, todo cargado
// (pedido del usuario 2026-10-08). El cuadrito que había antes solo hacía
// nombre y presentación; acá queda a mano todo lo que se define al dar de
// alta: códigos, volumen, envase, desarme, mínimos y proveedores.

type SkuFila = {
  id: string;
  nombre: string;
  codigo_interno: string;
  codigo_barras: string | null;
  volumen: number;
  unidad_volumen: "ml" | "l" | "un" | "g";
  tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
  unidades_contenidas: number;
  stock_minimo: number;
  stock_objetivo: number;
  es_retornable: boolean;
  tipo_envase_id: string | null;
  desarma_en_sku_id: string | null;
  desarma_en_cantidad: number | null;
  producto_id: string;
  producto: { nombre: string; marca_id: string; categoria_id: string } | null;
};

export default async function EditarSkuPage({ params }: { params: Promise<{ skuId: string }> }) {
  const { skuId } = await params;
  const supabase = await createClient();

  // Mismo permiso que el alta: dueño + encargado de Olavarría (ve_costos()).
  if (!(await veCostos(supabase))) {
    redirect("/productos");
  }

  const [
    { data: skuRaw },
    { data: marcas },
    { data: categorias },
    { data: productos },
    { data: tiposEnvase },
    { data: skus },
    { data: proveedores },
    { data: proveedorSkus },
  ] = await Promise.all([
    supabase
      .from("skus")
      .select(
        `id, nombre, codigo_interno, codigo_barras, volumen, unidad_volumen, tipo_presentacion,
         unidades_contenidas, stock_minimo, stock_objetivo, es_retornable, tipo_envase_id,
         desarma_en_sku_id, desarma_en_cantidad, producto_id,
         producto:productos ( nombre, marca_id, categoria_id )`,
      )
      .eq("id", skuId)
      .maybeSingle(),
    supabase.from("marcas").select("id, nombre").eq("activo", true).order("nombre"),
    supabase
      .from("categorias")
      .select("id, nombre, categoria_padre_id")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("productos")
      .select("id, nombre, marca:marcas ( nombre )")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("tipos_envase")
      .select("id, nombre, es_generico, valor_deposito")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("skus")
      .select(
        `id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true)
      .neq("id", skuId),
    supabase
      .from("proveedores")
      .select("id, razon_social, nombre_comercial")
      .eq("activo", true)
      .order("razon_social"),
    supabase.from("proveedor_skus").select("proveedor_id, costo_referencia").eq("sku_id", skuId),
  ]);

  const sku = skuRaw as unknown as SkuFila | null;
  if (!sku) notFound();

  // Cuántas otras presentaciones cuelgan del mismo producto: define si
  // cambiarle el nombre lo separa o lo edita en el lugar.
  const { count: hermanas } = await supabase
    .from("skus")
    .select("id", { count: "exact", head: true })
    .eq("producto_id", sku.producto_id)
    .neq("id", skuId);

  const skuEditar: SkuParaEditar = {
    id: sku.id,
    nombre: sku.nombre,
    codigoInterno: sku.codigo_interno,
    codigoBarras: sku.codigo_barras ?? "",
    volumen: String(sku.volumen),
    unidadVolumen: sku.unidad_volumen,
    tipoPresentacion: sku.tipo_presentacion,
    unidadesContenidas: String(sku.unidades_contenidas),
    stockMinimo: String(sku.stock_minimo),
    stockObjetivo: String(sku.stock_objetivo),
    esRetornable: sku.es_retornable,
    tipoEnvaseId: sku.tipo_envase_id ?? "",
    desarmaEnSkuId: sku.desarma_en_sku_id ?? "",
    desarmaEnCantidad: sku.desarma_en_cantidad != null ? String(sku.desarma_en_cantidad) : "",
    productoNombre: sku.producto?.nombre ?? "",
    marcaId: sku.producto?.marca_id ?? "",
    categoriaId: sku.producto?.categoria_id ?? "",
    hermanas: hermanas ?? 0,
    proveedores: (
      (proveedorSkus ?? []) as { proveedor_id: string; costo_referencia: number | null }[]
    ).map((p) => ({
      proveedorId: p.proveedor_id,
      costoReferencia: p.costo_referencia != null ? String(p.costo_referencia) : "",
    })),
  };

  return (
    <ProductoSkuForm
      marcas={(marcas ?? []) as MarcaOpcion[]}
      categorias={(categorias ?? []) as CategoriaOpcion[]}
      productos={(productos ?? []) as unknown as ProductoOpcion[]}
      tiposEnvase={(tiposEnvase ?? []) as TipoEnvaseOpcion[]}
      skus={(skus ?? []) as unknown as SkuOpcion[]}
      proveedores={(proveedores ?? []) as ProveedorOpcion[]}
      skuEditar={skuEditar}
    />
  );
}
