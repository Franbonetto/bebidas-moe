import { createClient } from "@/lib/supabase/server";
import { operaCentral, veCostos } from "@/lib/permisos";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { calcularPrecioVenta, type SkuParaPrecio, type SucursalParaPrecio } from "@/lib/precios";
import { calcularCostosQueSubieron, haceDias } from "../_components/dashboard/lib";
import { AlertRow, Badge, Card, EmptyState, SectionHeader } from "../_components/dashboard/ui";
import { PreferenciasPanel, type CategoriaAlerta } from "./_components/preferencias-panel";

// docs/arquitectura.md 1.12: "producto inmovilizado" ya usa 90 dias
// (dueno-dashboard.tsx). No hay un numero definido para "envases sin
// devolver hace mucho" -- se usa el mismo criterio como default razonable
// hasta que se confirme uno propio.
const CUTOFF_INMOVILIZADO_DIAS = 90;
const CUTOFF_ENVASES_DIAS = 90;
// Umbral de "margen bajo" confirmado por el usuario: por debajo de 10% de
// margen sobre el precio de venta efectivo (el mismo precio que ya usa
// bajoCostoEfectivo en lib/precios.ts -- el mas exigente de los dos medios
// de pago).
const MARGEN_MINIMO_PCT = 10;

type SkuInfo = SkuPresentacion & {
  id: string;
  nombre: string;
  stock_minimo: number;
  costo_actual: number | null;
  cascada_cerveza_lata: boolean;
  producto: { id: string; nombre: string; categoria_id: string; marca: { nombre: string } | null } | null;
};

type Sucursal = { id: string; nombre: string; es_central: boolean };

export default async function AlertasPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user!.id).maybeSingle();

  const esDuenoRol = usuario?.rol === "dueno";
  const central = await operaCentral(supabase);
  const puedeVerCostos = await veCostos(supabase);
  // Rol efectivo para decidir que alertas mostrar (arquitectura.md 1.12,
  // tabla de destinatarios): mismo criterio que app/(app)/page.tsx para
  // elegir dashboard.
  const rol: "dueno" | "olavarria" | "laprida" = esDuenoRol ? "dueno" : central ? "olavarria" : "laprida";

  const { data: preferenciasRaw } = await supabase
    .from("preferencias_alerta")
    .select("categoria, visible")
    .eq("usuario_id", user!.id);
  const ocultas = new Set(
    ((preferenciasRaw ?? []) as { categoria: CategoriaAlerta; visible: boolean }[])
      .filter((p) => !p.visible)
      .map((p) => p.categoria),
  );
  const preferenciasPorCategoria = Object.fromEntries(
    ((preferenciasRaw ?? []) as { categoria: CategoriaAlerta; visible: boolean }[]).map((p) => [
      p.categoria,
      p.visible,
    ]),
  ) as Partial<Record<CategoriaAlerta, boolean>>;

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre, es_central")
    .eq("activo", true);
  const sucursalesList = (sucursales ?? []) as Sucursal[];
  const olavarria = sucursalesList.find((s) => s.es_central);
  const laprida = sucursalesList.find((s) => !s.es_central);

  if (!olavarria || !laprida) {
    return <EmptyState title="Faltan sucursales configuradas" sub="Revisá que Olavarría y Laprida existan como sucursales activas." />;
  }

  const miSucursal = rol === "olavarria" ? olavarria : rol === "laprida" ? laprida : null;
  // Stock: el dueño ve las dos sucursales, cada encargado ve la propia.
  const sucursalesStock = miSucursal ? [miSucursal] : sucursalesList;

  const [
    { data: skus },
    { data: stock },
    { data: transferenciasEnTransito },
    { data: pedidosSinAtender },
    { data: ventaItemsSinStock },
    { data: historial },
    { data: movimientos },
    { data: stockEnvases },
    { data: movimientosEnvases },
    { data: precios },
    { data: preciosSucursal },
    { data: recargosSucursal },
    { data: recargosSku },
    { data: descuentosEfectivo },
  ] = await Promise.all([
    supabase
      .from("skus")
      .select(
        `id, nombre, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, stock_minimo,
         costo_actual, cascada_cerveza_lata,
         producto:productos ( id, nombre, categoria_id, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
    supabase
      .from("stock_sucursal")
      .select("sku_id, sucursal_id, cantidad")
      .in(
        "sucursal_id",
        sucursalesStock.map((s) => s.id),
      ),
    // Transferencia en transito sin recibir: solo Laprida es destino en el
    // flujo unidireccional (arquitectura.md 1.5) -- Olavarria nunca la ve.
    rol !== "olavarria"
      ? supabase
          .from("transferencias")
          .select(`id, pedido_id, fecha_despacho, pedido:pedidos ( numero ), transferencia_items ( cantidad_despachada )`)
          .eq("sucursal_destino_id", laprida.id)
          .eq("estado", "en_transito")
          .order("fecha_despacho", { ascending: true })
      : Promise.resolve({ data: [] }),
    rol !== "laprida"
      ? supabase
          .from("pedidos")
          .select("id, numero, fecha_envio, pedido_items ( cantidad_solicitada )")
          .eq("sucursal_origen_id", olavarria.id)
          .eq("estado", "enviado")
          .order("fecha_envio", { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase
      .from("venta_items")
      .select("sku_id, cantidad, venta:ventas ( sucursal_id, fecha )")
      .eq("vendido_sin_stock", true),
    puedeVerCostos
      ? supabase.from("historial_costos").select("sku_id, costo_unitario, fecha").order("fecha", { ascending: false })
      : Promise.resolve({ data: [] }),
    esDuenoRol
      ? supabase.from("movimientos_stock").select("sku_id, fecha").order("fecha", { ascending: false })
      : Promise.resolve({ data: [] }),
    rol === "olavarria"
      ? supabase
          .from("stock_envases")
          .select("tipo_envase_id, cantidad_vacios, tipo_envase:tipos_envase ( nombre )")
          .eq("sucursal_id", olavarria.id)
          .gt("cantidad_vacios", 0)
      : Promise.resolve({ data: [] }),
    rol === "olavarria"
      ? supabase
          .from("movimientos_envases")
          .select("tipo_envase_id, fecha")
          .eq("sucursal_id", olavarria.id)
          .order("fecha", { ascending: false })
      : Promise.resolve({ data: [] }),
    // Margen bajo: solo dueño (arquitectura.md 1.12). Mismos datos que
    // /precios/page.tsx, para no derivar el precio con un criterio distinto.
    esDuenoRol
      ? supabase.from("precios").select("sku_id, precio_base")
      : Promise.resolve({ data: [] }),
    esDuenoRol
      ? supabase.from("precios_sucursal").select("sucursal_id, sku_id, precio_override")
      : Promise.resolve({ data: [] }),
    esDuenoRol
      ? supabase.from("recargos_sucursal").select("sucursal_id, categoria_id, monto_fijo")
      : Promise.resolve({ data: [] }),
    esDuenoRol
      ? supabase.from("recargos_sku").select("sucursal_id, sku_id, monto_fijo")
      : Promise.resolve({ data: [] }),
    esDuenoRol
      ? supabase.from("descuentos_efectivo").select("sucursal_id, categoria_id, porcentaje")
      : Promise.resolve({ data: [] }),
  ]);

  const skusList = (skus ?? []) as unknown as SkuInfo[];
  const skuPorId = new Map(skusList.map((s) => [s.id, s]));
  const sucursalNombrePorId = new Map(sucursalesList.map((s) => [s.id, s.nombre]));

  // ---- Stock crítico: sin stock / bajo mínimo ----
  const stockPorClave = new Map<string, number>();
  for (const f of (stock ?? []) as { sku_id: string; sucursal_id: string; cantidad: number }[]) {
    stockPorClave.set(`${f.sku_id}:${f.sucursal_id}`, f.cantidad);
  }

  type StockAlerta = { sku: SkuInfo; sucursalId: string; cantidad: number; estado: "sin_stock" | "bajo_minimo" };
  const stockAlertas: StockAlerta[] = [];
  for (const sku of skusList) {
    for (const sucursal of sucursalesStock) {
      const cantidad = stockPorClave.get(`${sku.id}:${sucursal.id}`) ?? 0;
      if (cantidad <= 0) {
        stockAlertas.push({ sku, sucursalId: sucursal.id, cantidad, estado: "sin_stock" });
      } else if (sku.stock_minimo > 0 && cantidad < sku.stock_minimo) {
        stockAlertas.push({ sku, sucursalId: sucursal.id, cantidad, estado: "bajo_minimo" });
      }
    }
  }
  stockAlertas.sort((a, b) => (a.estado === b.estado ? a.cantidad - b.cantidad : a.estado === "sin_stock" ? -1 : 1));
  const sinStockCount = stockAlertas.filter((a) => a.estado === "sin_stock").length;
  const bajoMinimoCount = stockAlertas.filter((a) => a.estado === "bajo_minimo").length;

  // ---- Transferencias en tránsito sin recibir ----
  type Transferencia = {
    id: string;
    pedido_id: string;
    fecha_despacho: string;
    pedido: { numero: string } | null;
    transferencia_items: { cantidad_despachada: number }[];
  };
  const transferenciasList = (transferenciasEnTransito ?? []) as unknown as Transferencia[];

  // ---- Pedidos de Laprida sin atender ----
  type PedidoRow = {
    id: string;
    numero: string;
    fecha_envio: string | null;
    pedido_items: { cantidad_solicitada: number }[];
  };
  const pedidosSinAtenderList = (pedidosSinAtender ?? []) as unknown as PedidoRow[];

  // ---- Venta con stock en cero: alerta de ESTADO, solo mientras el SKU
  // siga sin stock hoy en esa sucursal (arquitectura.md 1.12: "desaparecen
  // solas al resolverse") ----
  type VentaSinStockRow = { sku_id: string; venta: { sucursal_id: string; fecha: string } | null };
  const ventaItemsSinStockList = (ventaItemsSinStock ?? []) as unknown as VentaSinStockRow[];
  const sucursalesVisiblesIds = new Set(sucursalesStock.map((s) => s.id));
  const ventaSinStockPorClave = new Map<string, string>();
  for (const item of ventaItemsSinStockList) {
    const sucursalId = item.venta?.sucursal_id;
    if (!sucursalId || !sucursalesVisiblesIds.has(sucursalId)) continue;
    if ((stockPorClave.get(`${item.sku_id}:${sucursalId}`) ?? 0) > 0) continue; // ya se resolvió
    const clave = `${item.sku_id}:${sucursalId}`;
    const actual = ventaSinStockPorClave.get(clave);
    if (!actual || (item.venta && item.venta.fecha > actual)) ventaSinStockPorClave.set(clave, item.venta!.fecha);
  }
  const ventasSinStockAlertas = [...ventaSinStockPorClave.entries()].map(([clave, fecha]) => {
    const [skuId, sucursalId] = clave.split(":");
    return { sku: skuPorId.get(skuId), sucursalId, fecha };
  });

  // ---- Costo aumentó (dueño + enc. Olavarría) ----
  const costosSubieron = puedeVerCostos
    ? calcularCostosQueSubieron((historial ?? []) as { sku_id: string; costo_unitario: number; fecha: string }[])
    : [];

  // ---- Producto inmovilizado (solo dueño) ----
  const inmovilizados: { sku: SkuInfo; unidades: number; ultimoMovimiento: string | null }[] = [];
  if (esDuenoRol) {
    const ultimoMovimientoPorSku = new Map<string, string>();
    for (const m of (movimientos ?? []) as { sku_id: string; fecha: string }[]) {
      if (!ultimoMovimientoPorSku.has(m.sku_id)) ultimoMovimientoPorSku.set(m.sku_id, m.fecha);
    }
    const cutoff = new Date().getTime() - CUTOFF_INMOVILIZADO_DIAS * 86_400_000;
    for (const sku of skusList) {
      let total = 0;
      for (const sucursal of sucursalesList) total += stockPorClave.get(`${sku.id}:${sucursal.id}`) ?? 0;
      if (total <= 0) continue;
      const ultimo = ultimoMovimientoPorSku.get(sku.id) ?? null;
      if (!ultimo || new Date(ultimo).getTime() < cutoff) {
        inmovilizados.push({ sku, unidades: total, ultimoMovimiento: ultimo });
      }
    }
    inmovilizados.sort((a, b) => b.unidades - a.unidades);
  }

  // ---- Margen bajo / precio bajo costo (solo dueño) ----
  type MargenAlerta = { sku: SkuInfo; sucursalId: string; precio: number; costo: number; margenPct: number };
  const margenBajoAlertas: MargenAlerta[] = [];
  if (esDuenoRol) {
    const precioBasePorSku = new Map<string, number>();
    for (const p of (precios ?? []) as { sku_id: string; precio_base: number }[]) precioBasePorSku.set(p.sku_id, p.precio_base);

    const overridePorClave = new Map<string, number>();
    for (const p of (preciosSucursal ?? []) as { sucursal_id: string; sku_id: string; precio_override: number }[])
      overridePorClave.set(`${p.sucursal_id}:${p.sku_id}`, p.precio_override);

    const recargoCategoriaPorClave = new Map<string, number>();
    for (const r of (recargosSucursal ?? []) as { sucursal_id: string; categoria_id: string; monto_fijo: number }[])
      recargoCategoriaPorClave.set(`${r.sucursal_id}:${r.categoria_id}`, r.monto_fijo);

    const recargoSkuPorClave = new Map<string, number>();
    for (const r of (recargosSku ?? []) as { sucursal_id: string; sku_id: string; monto_fijo: number }[])
      recargoSkuPorClave.set(`${r.sucursal_id}:${r.sku_id}`, r.monto_fijo);

    const descuentoPorClave = new Map<string, number>();
    for (const d of (descuentosEfectivo ?? []) as { sucursal_id: string; categoria_id: string; porcentaje: number }[])
      descuentoPorClave.set(`${d.sucursal_id}:${d.categoria_id}`, d.porcentaje);

    // Costo del x24 por familia (producto_id), igual que /precios/page.tsx:
    // solo para el aviso de "por debajo de costo" -- la base real de la
    // cascada es el precio de venta cargado a mano (2026-09-22).
    const costoX24PorProducto = new Map<string, number | null>();
    const precioVentaX24PorProducto = new Map<string, number | null>();
    for (const sku of skusList) {
      if (sku.cascada_cerveza_lata && sku.unidades_contenidas === 24 && sku.producto) {
        costoX24PorProducto.set(sku.producto.id, sku.costo_actual);
        precioVentaX24PorProducto.set(sku.producto.id, precioBasePorSku.get(sku.id) ?? null);
      }
    }

    for (const sku of skusList) {
      if (sku.costo_actual == null && !sku.cascada_cerveza_lata) continue;
      const categoriaId = sku.producto?.categoria_id ?? "";

      for (const sucursal of sucursalesList) {
        const skuParaPrecio: SkuParaPrecio = {
          id: sku.id,
          categoriaId,
          unidadesContenidas: sku.unidades_contenidas,
          cascadaCervezaLata: sku.cascada_cerveza_lata,
        };
        const sucursalParaPrecio: SucursalParaPrecio = { id: sucursal.id, esCentral: sucursal.es_central };

        const precioVenta = calcularPrecioVenta(skuParaPrecio, sucursalParaPrecio, {
          costoActualPropio: sku.costo_actual,
          costoActualX24Familia:
            sku.cascada_cerveza_lata && sku.producto ? costoX24PorProducto.get(sku.producto.id) ?? null : null,
          precioVentaX24Familia:
            sku.cascada_cerveza_lata && sku.producto ? precioVentaX24PorProducto.get(sku.producto.id) ?? null : null,
          overridePrecio: overridePorClave.get(`${sucursal.id}:${sku.id}`) ?? null,
          precioBaseManual: precioBasePorSku.get(sku.id) ?? null,
          recargoSkuMonto: recargoSkuPorClave.get(`${sucursal.id}:${sku.id}`) ?? null,
          recargoCategoriaMonto: recargoCategoriaPorClave.get(`${sucursal.id}:${categoriaId}`) ?? null,
          descuentoEfectivoPct: descuentoPorClave.get(`${sucursal.id}:${categoriaId}`) ?? null,
        });

        if (precioVenta.precioEfectivo == null || precioVenta.costoReferencia == null) continue;
        if (precioVenta.precioEfectivo <= 0) continue;
        const margenPct = ((precioVenta.precioEfectivo - precioVenta.costoReferencia) / precioVenta.precioEfectivo) * 100;
        if (margenPct < MARGEN_MINIMO_PCT) {
          margenBajoAlertas.push({
            sku,
            sucursalId: sucursal.id,
            precio: precioVenta.precioEfectivo,
            costo: precioVenta.costoReferencia,
            margenPct,
          });
        }
      }
    }
    margenBajoAlertas.sort((a, b) => a.margenPct - b.margenPct);
  }

  // ---- Envases sin devolver hace mucho (solo enc. Olavarría) ----
  type EnvaseFila = { tipo_envase_id: string; cantidad_vacios: number; tipo_envase: { nombre: string } | null };
  const stockEnvasesList = (stockEnvases ?? []) as unknown as EnvaseFila[];
  const ultimoMovimientoEnvasePorTipo = new Map<string, string>();
  for (const m of (movimientosEnvases ?? []) as { tipo_envase_id: string; fecha: string }[]) {
    if (!ultimoMovimientoEnvasePorTipo.has(m.tipo_envase_id)) ultimoMovimientoEnvasePorTipo.set(m.tipo_envase_id, m.fecha);
  }
  const cutoffEnvases = new Date().getTime() - CUTOFF_ENVASES_DIAS * 86_400_000;
  const envasesSinDevolver = stockEnvasesList
    .map((e) => ({ ...e, ultimoMovimiento: ultimoMovimientoEnvasePorTipo.get(e.tipo_envase_id) ?? null }))
    .filter((e) => !e.ultimoMovimiento || new Date(e.ultimoMovimiento).getTime() < cutoffEnvases);

  // Una categoria oculta por preferencia se trata como si no existiera
  // para este usuario -- ni cuenta para "todo al dia" ni se renderiza.
  const mostrarStock = stockAlertas.length > 0 && !ocultas.has("stock");
  const mostrarPedidos =
    (transferenciasList.length > 0 || pedidosSinAtenderList.length > 0) && !ocultas.has("pedidos_transferencias");
  const mostrarVentasSinStock = ventasSinStockAlertas.length > 0 && !ocultas.has("ventas_sin_stock");
  const mostrarCostos = puedeVerCostos && costosSubieron.length > 0 && !ocultas.has("costos");
  const mostrarInmovilizado = esDuenoRol && inmovilizados.length > 0 && !ocultas.has("inmovilizado");
  const mostrarRentabilidad = esDuenoRol && margenBajoAlertas.length > 0 && !ocultas.has("rentabilidad");
  const mostrarEnvases = rol === "olavarria" && envasesSinDevolver.length > 0 && !ocultas.has("envases");

  const hayAlgunaAlerta =
    mostrarStock ||
    mostrarPedidos ||
    mostrarVentasSinStock ||
    mostrarCostos ||
    mostrarInmovilizado ||
    mostrarRentabilidad ||
    mostrarEnvases;

  const categoriasDisponibles: { id: CategoriaAlerta; label: string }[] = [
    { id: "stock", label: "Stock crítico" },
    { id: "pedidos_transferencias", label: "Pedidos y transferencias" },
    { id: "ventas_sin_stock", label: "Ventas con stock en cero" },
    ...(puedeVerCostos ? [{ id: "costos" as const, label: "Costos que subieron" }] : []),
    ...(esDuenoRol
      ? [
          { id: "inmovilizado" as const, label: "Mercadería inmovilizada" },
          { id: "rentabilidad" as const, label: "Rentabilidad (margen bajo)" },
        ]
      : []),
    ...(rol === "olavarria" ? [{ id: "envases" as const, label: "Envases sin devolver" }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[15px] font-semibold text-text">Alertas</h1>
          <p className="mt-[2px] text-[12.5px] text-text-3">
            Se calculan al vuelo desde el estado actual — desaparecen solas apenas se resuelven.
          </p>
        </div>
        <PreferenciasPanel categorias={categoriasDisponibles} preferencias={preferenciasPorCategoria} />
      </div>

      {!hayAlgunaAlerta && <EmptyState title="Todo al día" sub="No hay alertas activas en este momento." />}

      {mostrarStock && (
        <div>
          <SectionHeader title="Stock" meta={`${sinStockCount} sin stock · ${bajoMinimoCount} bajo mínimo`} />
          <Card title="Productos con stock crítico">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Producto
                    </th>
                    {!miSucursal && (
                      <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                        Sucursal
                      </th>
                    )}
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Stock
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Mínimo
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stockAlertas.map((a, i) => (
                    <tr key={`${a.sku.id}:${a.sucursalId}:${i}`} className="border-b border-[#F1F1F3] last:border-b-0">
                      <td className="px-[14px] py-[9px] align-middle">
                        <p className="font-medium text-text">{a.sku.producto?.nombre ?? a.sku.nombre}</p>
                        <p className="text-[11.5px] text-text-3">
                          {[a.sku.producto?.marca?.nombre, presentacionLabel(a.sku)].filter(Boolean).join(" — ")}
                        </p>
                      </td>
                      {!miSucursal && (
                        <td className="px-[14px] py-[9px] align-middle text-text-2">
                          {sucursalNombrePorId.get(a.sucursalId)}
                        </td>
                      )}
                      <td
                        className={`px-[14px] py-[9px] text-right align-middle font-medium tabular-nums ${
                          a.estado === "sin_stock" ? "text-err" : "text-warn"
                        }`}
                      >
                        {a.cantidad}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {a.sku.stock_minimo}
                      </td>
                      <td className="px-[14px] py-[9px] align-middle">
                        {a.estado === "sin_stock" ? (
                          <Badge color="err">Sin stock</Badge>
                        ) : (
                          <Badge color="warn">Bajo mínimo</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {mostrarPedidos && (
        <div>
          <SectionHeader title="Pedidos y transferencias" />
          <div className="flex flex-col gap-[8px]">
            {pedidosSinAtenderList.map((p) => {
              const unidades = p.pedido_items.reduce((acc, i) => acc + i.cantidad_solicitada, 0);
              return (
                <AlertRow
                  key={p.id}
                  color="err"
                  title={`Pedido ${p.numero} de Laprida sin atender`}
                  sub={`${unidades} unidades${p.fecha_envio ? ` · enviado ${haceDias(p.fecha_envio)}` : ""}`}
                  href={`/pedidos/${p.id}`}
                />
              );
            })}
            {transferenciasList.map((t) => {
              const unidades = t.transferencia_items.reduce((acc, i) => acc + i.cantidad_despachada, 0);
              return (
                <AlertRow
                  key={t.id}
                  color="info"
                  title={`Transferencia de ${t.pedido?.numero ?? "pedido"} en tránsito`}
                  sub={`${unidades} unidades · despachada ${haceDias(t.fecha_despacho)}`}
                  href={`/pedidos/${t.pedido_id}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {mostrarVentasSinStock && (
        <div>
          <SectionHeader title="Ventas con stock en cero" />
          <div className="flex flex-col gap-[8px]">
            {ventasSinStockAlertas.map((v) => (
              <AlertRow
                key={`${v.sku?.id}:${v.sucursalId}`}
                color="warn"
                title={v.sku ? (v.sku.producto?.nombre ?? v.sku.nombre) : "SKU eliminado"}
                sub={`Se vendió sin stock en ${sucursalNombrePorId.get(v.sucursalId)} · última vez ${haceDias(v.fecha)} · sigue en cero, marcar para revisión de inventario`}
              />
            ))}
          </div>
        </div>
      )}

      {mostrarCostos && (
        <div>
          <SectionHeader title="Costos" meta="Últimos 30 días" />
          <Card title="Costos que subieron">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Producto
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Antes → Ahora
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Variación
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {costosSubieron.map((c) => {
                    const sku = skuPorId.get(c.sku_id);
                    return (
                      <tr key={c.sku_id} className="border-b border-[#F1F1F3] last:border-b-0">
                        <td className="px-[14px] py-[9px] align-middle">
                          <p className="font-medium text-text">{sku?.producto?.nombre ?? "SKU eliminado"}</p>
                          <p className="text-[11.5px] text-text-3">{haceDias(c.fecha)}</p>
                        </td>
                        <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                          {formatoMoneda.format(c.costo_anterior)} → {formatoMoneda.format(c.costo_nuevo)}
                        </td>
                        <td className="px-[14px] py-[9px] text-right align-middle font-medium tabular-nums text-orange">
                          +{c.variacion_pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {mostrarInmovilizado && (
        <div>
          <SectionHeader title="Mercadería inmovilizada" meta={`${CUTOFF_INMOVILIZADO_DIAS}+ días sin movimiento`} />
          <Card title="Sin movimiento reciente">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Producto
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Unidades
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Último movimiento
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {inmovilizados.map((i) => (
                    <tr key={i.sku.id} className="border-b border-[#F1F1F3] last:border-b-0">
                      <td className="px-[14px] py-[9px] align-middle">
                        <p className="font-medium text-text">{i.sku.producto?.nombre ?? i.sku.nombre}</p>
                        <p className="text-[11.5px] text-text-3">
                          {[i.sku.producto?.marca?.nombre, presentacionLabel(i.sku)].filter(Boolean).join(" — ")}
                        </p>
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {i.unidades}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle text-text-3">
                        {i.ultimoMovimiento ? haceDias(i.ultimoMovimiento) : "sin movimientos"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {mostrarRentabilidad && (
        <div>
          <SectionHeader title="Rentabilidad" meta={`Margen menor a ${MARGEN_MINIMO_PCT}%`} />
          <Card title="Precios con margen bajo">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Producto
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                      Sucursal
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Precio
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Costo
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                      Margen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {margenBajoAlertas.map((m, i) => (
                    <tr key={`${m.sku.id}:${m.sucursalId}:${i}`} className="border-b border-[#F1F1F3] last:border-b-0">
                      <td className="px-[14px] py-[9px] align-middle">
                        <p className="font-medium text-text">{m.sku.producto?.nombre ?? m.sku.nombre}</p>
                        <p className="text-[11.5px] text-text-3">
                          {[m.sku.producto?.marca?.nombre, presentacionLabel(m.sku)].filter(Boolean).join(" — ")}
                        </p>
                      </td>
                      <td className="px-[14px] py-[9px] align-middle text-text-2">
                        {sucursalNombrePorId.get(m.sucursalId)}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text">
                        {formatoMoneda.format(m.precio)}
                      </td>
                      <td className="px-[14px] py-[9px] text-right align-middle tabular-nums text-text-2">
                        {formatoMoneda.format(m.costo)}
                      </td>
                      <td
                        className={`px-[14px] py-[9px] text-right align-middle font-medium tabular-nums ${
                          m.margenPct <= 0 ? "text-err" : "text-warn"
                        }`}
                      >
                        {m.margenPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {mostrarEnvases && (
        <div>
          <SectionHeader title="Envases" meta={`${CUTOFF_ENVASES_DIAS}+ días acumulados`} />
          <div className="flex flex-col gap-[8px]">
            {envasesSinDevolver.map((e) => (
              <AlertRow
                key={e.tipo_envase_id}
                color="orange"
                title={`${e.cantidad_vacios} vacíos de ${e.tipo_envase?.nombre ?? "envase"} sin devolver`}
                sub={
                  e.ultimoMovimiento
                    ? `Último movimiento ${haceDias(e.ultimoMovimiento)}`
                    : "Sin movimientos registrados"
                }
                href="/envases"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
