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

  const [
    { data: sugerencias },
    { data: skus },
    { data: proveedorSkus },
    { data: todosProveedores },
    { data: comprados },
    vendido,
    aLaprida,
  ] = await Promise.all([
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
    // Lo que de hecho se le compró a cada proveedor: cargar una compra no
    // escribe proveedor_skus, así que sin esto un proveedor con compras
    // reales pero sin la asociación manual no mostraba productos (mismo caso
    // que la ficha del proveedor, 2026-11-06, visto con Coca-Cola).
    traerTodo(
      supabase.from("compra_items").select("id, sku_id, compra:compras!inner ( proveedor_id, estado )"),
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

  const proveedoresActivos = new Map(
    (todosProveedores ?? []).map((p) => [p.id, p.nombre_comercial ?? p.razon_social] as const),
  );
  for (const fila of (comprados ?? []) as unknown as {
    sku_id: string;
    compra: { proveedor_id: string; estado: string } | null;
  }[]) {
    if (!fila.compra || fila.compra.estado === "borrador") continue;
    const nombre = proveedoresActivos.get(fila.compra.proveedor_id);
    if (!nombre) continue;
    const lista = proveedoresPorSku.get(fila.sku_id) ?? [];
    if (lista.some((p) => p.id === fila.compra!.proveedor_id)) continue;
    lista.push({ id: fila.compra.proveedor_id, nombre });
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
