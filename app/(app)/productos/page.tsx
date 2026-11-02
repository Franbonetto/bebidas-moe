import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { veCostos, operaSucursal } from "@/lib/permisos";
import { ProductosTable, type SkuRow, type Sucursal } from "./_components/productos-table";

type StockRow = {
  sku_id: string;
  sucursal_id: string;
  cantidad: number;
};

export default async function ProductosPage() {
  const supabase = await createClient();
  const puedeCrear = await veCostos(supabase);

  const { data: sucursalesRaw } = await traerTodo(
    supabase
      .from("sucursales")
      .select("id, nombre, es_central")
      .eq("activo", true)
      .order("es_central", { ascending: false }),
  );
  const sucursalesTodas = (sucursalesRaw ?? []) as Sucursal[];

  // El encargado de Laprida no ve stock de Olavarría (ni el de ninguna otra
  // sucursal que no opere): dueño y encargado de Olavarría (ve_costos())
  // ven todas, Laprida solo la suya -- mismo criterio de opera_sucursal()
  // que ya se usa en pedidos, envíos, inventarios, etc.
  const operables = puedeCrear
    ? sucursalesTodas.map(() => true)
    : await Promise.all(sucursalesTodas.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesList = sucursalesTodas.filter((_, i) => operables[i]);
  const sucursalIds = sucursalesList.map((s) => s.id);

  const [{ data: skus }, { data: stock }] = await Promise.all([
    traerTodo(
      supabase
        .from("skus")
        // El costo (costo_actual) no se muestra acá: depende del rol
        // (ve_costos()) y todavía no hay costos cargados. Cuando se
        // implemente, se agrega como columna condicional según rol, no se
        // deja una columna a medio hacer ahora.
        .select(
          `id, nombre, codigo_interno, codigo_barras, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, stock_minimo,
           producto:productos ( nombre, marca:marcas ( nombre ), categoria:categorias ( nombre ) )`,
        )
        .eq("activo", true),
    ),
    traerTodo(
      supabase.from("stock_sucursal").select("sku_id, sucursal_id, cantidad").in("sucursal_id", sucursalIds),
      ["sku_id", "sucursal_id"],
    ),
  ]);

  const skusList = (skus ?? []) as unknown as Omit<SkuRow, "stockPorSucursal">[];
  const stockList = (stock ?? []) as StockRow[];

  const stockPorSku = new Map<string, Record<string, number>>();
  for (const fila of stockList) {
    const stockSku = stockPorSku.get(fila.sku_id) ?? {};
    stockSku[fila.sucursal_id] = fila.cantidad;
    stockPorSku.set(fila.sku_id, stockSku);
  }

  const skusConStock: SkuRow[] = skusList.map((sku) => ({
    ...sku,
    stockPorSucursal: stockPorSku.get(sku.id) ?? {},
  }));

  // Ordenado en JS (no en la query) porque involucra dos niveles de join
  // embebido (sku -> producto -> marca), que PostgREST no ordena bien de
  // forma nativa. Marca primero para que las presentaciones de un mismo
  // producto queden agrupadas.
  skusConStock.sort((a, b) => {
    const marcaA = a.producto?.marca?.nombre ?? "";
    const marcaB = b.producto?.marca?.nombre ?? "";
    if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");

    const productoA = a.producto?.nombre ?? "";
    const productoB = b.producto?.nombre ?? "";
    if (productoA !== productoB) return productoA.localeCompare(productoB, "es");

    return a.unidades_contenidas - b.unidades_contenidas;
  });

  return <ProductosTable sucursales={sucursalesList} skus={skusConStock} puedeCrear={puedeCrear} />;
}
