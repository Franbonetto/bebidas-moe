import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { veCostos } from "@/lib/permisos";
import { fechaOperativa } from "@/lib/fecha";
import { PinProvider } from "@/app/(app)/_components/pin-gate";
import { type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { NuevoPrestamoForm, type SkuPrestamo, type ProveedorOpcion } from "./_components/nuevo-prestamo-form";
import { ListaPrestamos, type PrestamoActivo, type PrestamoHistorial } from "./_components/lista-prestamos";

// Préstamos de mercadería a proveedores (pedido del usuario 2026-10-31,
// ver supabase/migrations/20261031090000_prestamos_proveedor.sql): un
// proveedor pide prestado algo y lo devuelve a los días. Solo se originan
// desde la central (Olavarría) y solo los ve quien ve costos y proveedores
// -- mismo permiso que compras.
export default async function PrestamosPage() {
  const supabase = await createClient();

  const puede = await veCostos(supabase);
  if (!puede) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés permiso para ver préstamos a proveedores.
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
    { data: proveedoresRaw },
    { data: skusRaw },
    { data: stockRaw },
    { data: activosRaw },
    { data: historialRaw },
  ] = await Promise.all([
    traerTodo(
      supabase
        .from("proveedores")
        .select("id, razon_social, nombre_comercial")
        .eq("activo", true)
        .order("razon_social"),
    ),
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
        .from("prestamos_proveedor")
        .select(
          `id, fecha_prestamo, fecha_estimada_devolucion, nota,
           proveedor:proveedores ( razon_social, nombre_comercial ),
           usuario:usuarios!prestamos_proveedor_usuario_id_fkey ( nombre ),
           prestamo_items ( sku_id, cantidad_prestada, cantidad_devuelta, sku:skus ( nombre ) )`,
        )
        .eq("estado", "activo")
        .order("fecha_prestamo", { ascending: true }),
    ),
    supabase
      .from("prestamos_proveedor")
      .select(
        `id, fecha_prestamo, fecha_devolucion, nota,
         proveedor:proveedores ( razon_social, nombre_comercial ),
         usuario:usuarios!prestamos_proveedor_usuario_id_fkey ( nombre ),
         usuario_devolucion:usuarios!prestamos_proveedor_usuario_devolucion_id_fkey ( nombre ),
         prestamo_items ( cantidad_prestada, sku:skus ( nombre ) )`,
      )
      .eq("estado", "devuelto")
      .order("fecha_devolucion", { ascending: false })
      .limit(30),
  ]);

  // Supabase devuelve la relación anidada como objeto o como array según el
  // caso; se normaliza acá para no ensuciar el resto.
  const uno = <T,>(rel: T | T[] | null): T | null => (Array.isArray(rel) ? rel[0] ?? null : rel);

  const nombreProveedor = (rel: unknown) => {
    const p = uno(rel) as { razon_social: string; nombre_comercial: string | null } | null;
    return p ? (p.nombre_comercial?.trim() || p.razon_social) : "Proveedor";
  };

  const nombreUsuario = (rel: unknown) => (uno(rel) as { nombre: string } | null)?.nombre ?? null;

  const proveedores: ProveedorOpcion[] = (proveedoresRaw ?? []).map((p) => ({
    id: p.id,
    label: p.nombre_comercial?.trim() || p.razon_social,
  }));

  const stockPorSku = new Map((stockRaw ?? []).map((s) => [s.sku_id, s.cantidad]));

  const skus: SkuPrestamo[] = (skusRaw ?? []).map((s) => {
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

  const activos: PrestamoActivo[] = (activosRaw ?? []).map((p) => ({
    id: p.id,
    proveedorNombre: nombreProveedor(p.proveedor),
    usuarioNombre: nombreUsuario(p.usuario) ?? "—",
    fechaPrestamo: p.fecha_prestamo,
    fechaEstimadaDevolucion: p.fecha_estimada_devolucion,
    atrasado: p.fecha_estimada_devolucion != null && p.fecha_estimada_devolucion < hoy,
    nota: p.nota,
    items: (p.prestamo_items ?? []).map((item: {
      sku_id: string;
      cantidad_prestada: number;
      cantidad_devuelta: number;
      sku: unknown;
    }) => ({
      skuId: item.sku_id,
      skuNombre: (uno(item.sku) as { nombre: string } | null)?.nombre ?? "Producto",
      cantidadPrestada: item.cantidad_prestada,
      cantidadDevuelta: item.cantidad_devuelta,
    })),
  }));

  const historial: PrestamoHistorial[] = (historialRaw ?? []).map((p) => ({
    id: p.id,
    proveedorNombre: nombreProveedor(p.proveedor),
    usuarioNombre: nombreUsuario(p.usuario) ?? "—",
    usuarioDevolucionNombre: nombreUsuario(p.usuario_devolucion),
    fechaPrestamo: p.fecha_prestamo,
    fechaDevolucion: p.fecha_devolucion,
    nota: p.nota,
    items: (p.prestamo_items ?? []).map((item: { cantidad_prestada: number; sku: unknown }) => ({
      skuNombre: (uno(item.sku) as { nombre: string } | null)?.nombre ?? "Producto",
      cantidadPrestada: item.cantidad_prestada,
    })),
  }));

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[17px] font-semibold text-text">
          Préstamos a proveedores — {sucursalCentral.nombre}
        </h1>
        <Link href="/vender" className="text-[12.5px] text-text-2 hover:text-text">
          ← Volver a vender
        </Link>
      </div>

      <PinProvider>
        <div className="mb-5">
          <NuevoPrestamoForm skus={skus} proveedores={proveedores} />
        </div>

        <ListaPrestamos activos={activos} historial={historial} />
      </PinProvider>
    </div>
  );
}
