import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { operaSucursal } from "@/lib/permisos";
import { fechaOperativa, inicioDeSemana } from "@/lib/fecha";
import { PedidoCompraForm, type SugerenciaCompraSku } from "../../_components/pedido-compra-form";
import { enviadoPorSku, vendidoPorSku } from "../../_lib/vendido";

type Sugerencia = {
  sku_id: string;
  stock_actual: number;
  en_camino: number;
  stock_objetivo: number;
  sugerido: number;
};

export default async function NuevoPedidoCompraPage() {
  const supabase = await createClient();

  const { data: central } = await supabase.from("sucursales").select("id").eq("es_central", true).single();

  if (!central || !(await operaSucursal(supabase, central.id))) {
    redirect("/pedidos");
  }

  // La semana del negocio es de lunes a domingo (ver lib/fecha.ts): se abre
  // con lo vendido desde el lunes, y la encargada puede cambiar las fechas.
  const lunes = inicioDeSemana();

  const [{ data: sugerencias }, { data: skus }, { data: proveedorSkus }, { data: todosProveedores }, vendido, aLaprida] =
    await Promise.all([
    supabase.rpc("sugerir_compra_semanal"),
    traerTodo(
      supabase
        .from("skus")
        .select(
          `id, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           producto:productos ( nombre, marca:marcas ( nombre ), categoria:categorias ( nombre ) )`,
        )
        .eq("activo", true),
    ),
    traerTodo(
      supabase
        .from("proveedor_skus")
        .select("sku_id, proveedor:proveedores ( id, razon_social, nombre_comercial )")
        .eq("activo", true),
      ["proveedor_id", "sku_id"],
    ),
    // Todos los proveedores activos, para poder elegir uno aunque el producto
    // todavía no lo tenga asociado.
    traerTodo(
      supabase.from("proveedores").select("id, razon_social, nombre_comercial").eq("activo", true),
    ),
    vendidoPorSku(supabase, central.id, lunes.toISOString(), null),
    enviadoPorSku(supabase, central.id, lunes.toISOString(), null),
  ]);

  const skuPorId = new Map((skus ?? []).map((s) => [s.id, s]));

  const filas: SugerenciaCompraSku[] = ((sugerencias ?? []) as Sugerencia[])
    .map((s) => {
      const sku = skuPorId.get(s.sku_id);
      if (!sku) return null;
      return { ...s, sku: sku as unknown as SugerenciaCompraSku["sku"] };
    })
    .filter((f): f is SugerenciaCompraSku => f !== null);

  // Un SKU puede tener más de un proveedor cargado (proveedor_skus es
  // muchos a muchos, sin uno "principal") -- se agrupa por cada proveedor
  // que lo tenga asociado, y el que no tenga ninguno queda en su propio
  // grupo "Sin proveedor asignado" (decisión del usuario 2026-09-21).
  const proveedoresPorSku = new Map<string, { id: string; nombre: string }[]>();
  for (const fila of (proveedorSkus ?? []) as unknown as {
    sku_id: string;
    proveedor: { id: string; razon_social: string; nombre_comercial: string | null } | null;
  }[]) {
    if (!fila.proveedor) continue;
    const lista = proveedoresPorSku.get(fila.sku_id) ?? [];
    lista.push({ id: fila.proveedor.id, nombre: fila.proveedor.nombre_comercial ?? fila.proveedor.razon_social });
    proveedoresPorSku.set(fila.sku_id, lista);
  }

  return (
    <PedidoCompraForm
      filas={filas}
      proveedoresPorSku={Object.fromEntries(proveedoresPorSku)}
      proveedores={(todosProveedores ?? []).map((p) => ({
        id: p.id,
        nombre: p.nombre_comercial ?? p.razon_social,
      }))}
      vendidoInicial={Object.fromEntries(vendido)}
      aLapridaInicial={Object.fromEntries(aLaprida)}
      desdeInicial={fechaOperativa(lunes)}
      hoy={fechaOperativa()}
    />
  );
}
