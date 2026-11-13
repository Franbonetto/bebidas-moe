import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { veCostos } from "@/lib/permisos";
import { fechaOperativa } from "@/lib/fecha";
import { PinProvider } from "@/app/(app)/_components/pin-gate";
import { type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { NuevaConsignacionForm, type SkuConsignacion } from "./_components/nueva-consignacion-form";
import { ListaConsignaciones, type ConsignacionActiva, type ConsignacionHistorial } from "./_components/lista-consignaciones";

// Consignación a clientes (pedido del usuario 2026-11-12, ver
// supabase/migrations/20261112090000_consignaciones.sql): un cliente se
// lleva mercadería sin pagarla y a los días vuelve con lo que no vendió.
// Entrega y devolución total (sin venta) se manejan acá; la liquidación
// con venta se hace desde el POS ("Liquidar en el POS", /vender). Solo se
// origina desde la central y solo la ve quien ve costos -- mismo permiso
// que préstamos a proveedores.
export default async function ConsignacionesPage() {
  const supabase = await createClient();

  const puede = await veCostos(supabase);
  if (!puede) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés permiso para ver consignaciones.
      </div>
    );
  }

  const { data: sucursalCentral } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("es_central", true)
    .maybeSingle();

  if (!sucursalCentral) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No se encontró la sucursal central.
      </div>
    );
  }

  const skuSelect = `id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
     producto:productos ( nombre, marca:marcas ( nombre ) )`;

  const [
    { data: skusRaw },
    { data: stockRaw },
    { data: activasRaw },
    { data: historialRaw },
  ] = await Promise.all([
    traerTodo(
      supabase.from("skus").select(skuSelect).eq("activo", true),
    ),
    traerTodo(
      supabase
        .from("stock_sucursal")
        .select("sku_id, cantidad")
        .eq("sucursal_id", sucursalCentral.id),
      ["sku_id", "sucursal_id"],
    ),
    traerTodo(
      supabase
        .from("consignaciones")
        .select(
          `id, cliente_nombre, cliente_telefono, fecha_entrega, fecha_estimada_devolucion, nota,
           usuario:usuarios!consignaciones_usuario_id_fkey ( nombre ),
           consignacion_items ( sku_id, cantidad_entregada, sku:skus ( nombre ) )`,
        )
        .eq("estado", "activa")
        .order("fecha_entrega", { ascending: true }),
    ),
    supabase
      .from("consignaciones")
      .select(
        `id, cliente_nombre, fecha_entrega, fecha_liquidacion, nota, venta_id,
         usuario:usuarios!consignaciones_usuario_id_fkey ( nombre ),
         usuario_liquidacion:usuarios!consignaciones_usuario_liquidacion_id_fkey ( nombre ),
         consignacion_items ( cantidad_entregada, sku:skus ( nombre ) )`,
      )
      .eq("estado", "liquidada")
      .order("fecha_liquidacion", { ascending: false })
      .limit(30),
  ]);

  const uno = <T,>(rel: T | T[] | null): T | null => (Array.isArray(rel) ? rel[0] ?? null : rel);

  const nombreUsuario = (rel: unknown) => (uno(rel) as { nombre: string } | null)?.nombre ?? null;

  const stockPorSku = new Map((stockRaw ?? []).map((s) => [s.sku_id, s.cantidad]));

  const skus: SkuConsignacion[] = (skusRaw ?? []).map((s) => {
    const producto = uno(s.producto) as { nombre: string; marca: unknown } | null;
    const marca = producto ? (uno(producto.marca) as { nombre: string } | null) : null;
    return {
      id: s.id,
      nombre: producto?.nombre ?? s.nombre,
      marcaNombre: marca?.nombre ?? null,
      codigoInterno: s.codigo_interno,
      presentacion: {
        tipo_presentacion: s.tipo_presentacion,
        volumen: s.volumen,
        unidad_volumen: s.unidad_volumen,
        unidades_contenidas: s.unidades_contenidas,
      } as SkuPresentacion,
      stock: stockPorSku.get(s.id) ?? 0,
    };
  });

  const hoy = fechaOperativa();

  const activas: ConsignacionActiva[] = (activasRaw ?? []).map((c) => ({
    id: c.id,
    clienteNombre: c.cliente_nombre,
    clienteTelefono: c.cliente_telefono,
    usuarioNombre: nombreUsuario(c.usuario) ?? "—",
    fechaEntrega: c.fecha_entrega,
    fechaEstimadaDevolucion: c.fecha_estimada_devolucion,
    atrasado: c.fecha_estimada_devolucion != null && c.fecha_estimada_devolucion < hoy,
    nota: c.nota,
    items: (c.consignacion_items ?? []).map((item: {
      sku_id: string;
      cantidad_entregada: number;
      sku: unknown;
    }) => ({
      skuId: item.sku_id,
      skuNombre: (uno(item.sku) as { nombre: string } | null)?.nombre ?? "Producto",
      cantidadEntregada: item.cantidad_entregada,
    })),
  }));

  const historial: ConsignacionHistorial[] = (historialRaw ?? []).map((c) => ({
    id: c.id,
    clienteNombre: c.cliente_nombre,
    usuarioNombre: nombreUsuario(c.usuario) ?? "—",
    usuarioLiquidacionNombre: nombreUsuario(c.usuario_liquidacion),
    fechaEntrega: c.fecha_entrega,
    fechaLiquidacion: c.fecha_liquidacion,
    ventaId: c.venta_id,
    nota: c.nota,
    items: (c.consignacion_items ?? []).map((item: { cantidad_entregada: number; sku: unknown }) => ({
      skuNombre: (uno(item.sku) as { nombre: string } | null)?.nombre ?? "Producto",
      cantidadEntregada: item.cantidad_entregada,
    })),
  }));

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[17px] font-semibold text-text">
          Consignaciones — {sucursalCentral.nombre}
        </h1>
        <Link href="/vender" className="text-[12.5px] text-text-2 hover:text-text">
          ← Volver a vender
        </Link>
      </div>

      <PinProvider>
        <div className="mb-5">
          <NuevaConsignacionForm skus={skus} />
        </div>

        <ListaConsignaciones activas={activas} historial={historial} />
      </PinProvider>
    </div>
  );
}
