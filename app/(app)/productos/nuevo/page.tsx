import { redirect } from "next/navigation";
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
} from "./_components/producto-sku-form";

export default async function NuevoProductoPage() {
  const supabase = await createClient();

  // Alta de catálogo: mismo permiso que ya carga precios/costos (dueño +
  // encargado Olavarría, ve_costos()) -- Laprida sigue solo lectura
  // (arquitectura.md 1.11, política RLS del bloque 2 sin tocar).
  if (!(await veCostos(supabase))) {
    redirect("/productos");
  }

  const [
    { data: marcas },
    { data: categorias },
    { data: productos },
    { data: tiposEnvase },
    { data: skus },
    { data: proveedores },
  ] = await Promise.all([
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
    supabase.from("tipos_envase").select("id, nombre, es_generico, valor_deposito").eq("activo", true).order("nombre"),
    supabase
      .from("skus")
      .select(
        `id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("proveedores")
      .select("id, razon_social, nombre_comercial")
      .eq("activo", true)
      .order("razon_social"),
  ]);

  return (
    <ProductoSkuForm
      marcas={(marcas ?? []) as MarcaOpcion[]}
      categorias={(categorias ?? []) as CategoriaOpcion[]}
      productos={(productos ?? []) as unknown as ProductoOpcion[]}
      tiposEnvase={(tiposEnvase ?? []) as TipoEnvaseOpcion[]}
      skus={(skus ?? []) as unknown as SkuOpcion[]}
      proveedores={(proveedores ?? []) as ProveedorOpcion[]}
    />
  );
}
