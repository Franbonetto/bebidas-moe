import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { BuscarVentaList, type VentaRow } from "./_components/buscar-venta-list";

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

export default async function DevolucionesPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal: sucursalParam } = await searchParams;
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre, es_central")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés ninguna sucursal asignada.
      </div>
    );
  }

  const sucursal =
    sucursalesOperables.find((s) => s.id === sucursalParam) ?? sucursalesOperables[0];

  // Sin límite de tiempo para devolver (arquitectura.md 1.10): se listan
  // las ventas de los últimos 90 días por defecto para no traer todo el
  // historico siempre, pero la busqueda por producto no tiene tope de
  // fecha propio -- si hace falta una venta mas vieja, se puede ampliar
  // esta ventana desde acá mismo.
  const desde = new Date();
  desde.setDate(desde.getDate() - 90);

  const { data: ventasRaw } = await supabase
    .from("ventas")
    .select(
      `id, fecha, medio_pago, total,
       venta_items ( cantidad, sku:skus ( id, nombre, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas, producto:productos ( nombre, marca:marcas ( nombre ) ) ) )`,
    )
    .eq("sucursal_id", sucursal.id)
    .eq("estado", "confirmada")
    .gte("fecha", desde.toISOString())
    .order("fecha", { ascending: false })
    .limit(300);

  const ventas: VentaRow[] = ((ventasRaw ?? []) as unknown as VentaFila[]).map((v) => ({
    id: v.id,
    fecha: v.fecha,
    medioPago: v.medio_pago,
    total: v.total,
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
      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/vender/devoluciones?sucursal=${s.id}`}
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

      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-text">Devoluciones — {sucursal.nombre}</h1>
        <Link href="/vender" className="text-[12.5px] text-text-2 hover:text-text">
          ← Volver a vender
        </Link>
      </div>

      <BuscarVentaList ventas={ventas} />
    </div>
  );
}
