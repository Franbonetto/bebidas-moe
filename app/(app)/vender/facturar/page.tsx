import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { BuscarVentaFacturarList, type VentaFacturarRow } from "./_components/buscar-venta-facturar-list";

type SkuInfo = SkuPresentacion & {
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type VentaFila = {
  id: string;
  fecha: string;
  medio_pago: string;
  total: number;
  venta_items: { cantidad: number; sku: SkuInfo | null }[];
};

export default async function FacturarPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal: sucursalParam } = await searchParams;
  const supabase = await createClient();

  // Cualquier sucursal donde el usuario opere puede aparecer acá -- la
  // pantalla igual va a avisar si a esa sucursal le falta el punto de
  // venta ARCA (ver "No hay punto de venta" más abajo / configuración).
  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true);

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(
    sucursalesList.map((s) => operaSucursal(supabase, s.id)),
  );
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés ninguna sucursal asignada para facturar.
      </div>
    );
  }

  const sucursal =
    sucursalesOperables.find((s) => s.id === sucursalParam) ?? sucursalesOperables[0];

  const desde = new Date();
  desde.setDate(desde.getDate() - 90);

  const [{ data: ventasRaw }, { data: comprobantesRaw }] = await Promise.all([
    supabase
      .from("ventas")
      .select(
        `id, fecha, medio_pago, total,
         venta_items ( cantidad, sku:skus ( id, nombre, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, producto:productos ( nombre, marca:marcas ( nombre ) ) ) )`,
      )
      .eq("sucursal_id", sucursal.id)
      .eq("estado", "confirmada")
      .gte("fecha", desde.toISOString())
      .order("fecha", { ascending: false })
      .limit(300),
    supabase.from("comprobantes_fiscales").select("venta_id, estado"),
  ]);

  const estadoPorVenta = new Map<string, string>();
  for (const c of (comprobantesRaw ?? []) as { venta_id: string; estado: string }[]) {
    estadoPorVenta.set(c.venta_id, c.estado);
  }

  const ventas: VentaFacturarRow[] = ((ventasRaw ?? []) as unknown as VentaFila[]).map((v) => ({
    id: v.id,
    fecha: v.fecha,
    medioPago: v.medio_pago,
    total: v.total,
    estadoComprobante: estadoPorVenta.get(v.id) ?? null,
    resumen: v.venta_items
      .filter((it) => it.sku)
      .map((it) => `${it.cantidad}x ${it.sku!.producto?.nombre ?? ""}`)
      .join(", "),
    textoBusqueda: v.venta_items
      .filter((it) => it.sku)
      .map((it) => `${it.sku!.producto?.nombre ?? ""} ${it.sku!.producto?.marca?.nombre ?? ""} ${presentacionLabel(it.sku!)}`)
      .join(" "),
  }));

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-text">Facturar — {sucursal.nombre}</h1>
        <div className="flex gap-2">
          <Link href="/vender/facturar/configuracion" className="text-[12.5px] text-text-2 hover:text-text">
            Configuración
          </Link>
          <Link href="/vender" className="text-[12.5px] text-text-2 hover:text-text">
            ← Volver a vender
          </Link>
        </div>
      </div>

      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/vender/facturar?sucursal=${s.id}`}
              className={`rounded-[6px] border px-[10px] py-[4px] text-[12px] font-medium ${
                s.id === sucursal.id
                  ? "border-moe bg-moe-soft text-moe"
                  : "border-border bg-bg text-text-2 hover:bg-bg-2"
              }`}
            >
              {s.nombre}
            </Link>
          ))}
        </div>
      )}

      <BuscarVentaFacturarList ventas={ventas} sucursalNombre={sucursal.nombre} />
    </div>
  );
}
