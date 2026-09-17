import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import type { SkuCatalogo } from "@/app/(app)/compras/_components/sku-picker";
import { DevolucionForm, type VentaItemRow } from "./_components/devolucion-form";

type SkuInfo = SkuPresentacion & {
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type VentaItemFila = {
  id: string;
  sku_id: string;
  cantidad: number;
  precio_unitario: number;
  sku: SkuInfo | null;
};

export default async function DevolucionVentaPage({
  params,
}: {
  params: Promise<{ ventaId: string }>;
}) {
  const { ventaId } = await params;
  const supabase = await createClient();

  const { data: venta } = await supabase
    .from("ventas")
    .select("id, sucursal_id, fecha, medio_pago, total, sucursal:sucursales ( nombre )")
    .eq("id", ventaId)
    .maybeSingle();

  if (!venta) notFound();

  const puedeOperar = await operaSucursal(supabase, venta.sucursal_id);
  if (!puedeOperar) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés permiso para hacer devoluciones de esta venta.
      </div>
    );
  }

  const [{ data: ventaItemsRaw }, { data: devolucionItemsRaw }, { data: skusRaw }] = await Promise.all([
    supabase
      .from("venta_items")
      .select(
        `id, sku_id, cantidad, precio_unitario,
         sku:skus ( id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           producto:productos ( nombre, marca:marcas ( nombre ) ) )`,
      )
      .eq("venta_id", ventaId),
    supabase.from("devolucion_items").select("venta_item_id, cantidad"),
    supabase
      .from("skus")
      .select(
        `id, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
         producto:productos ( nombre, marca:marcas ( nombre ) )`,
      )
      .eq("activo", true),
  ]);

  const yaDevueltoPorItem = new Map<string, number>();
  for (const d of (devolucionItemsRaw ?? []) as { venta_item_id: string; cantidad: number }[]) {
    yaDevueltoPorItem.set(d.venta_item_id, (yaDevueltoPorItem.get(d.venta_item_id) ?? 0) + d.cantidad);
  }

  const ventaItems: VentaItemRow[] = ((ventaItemsRaw ?? []) as unknown as VentaItemFila[])
    .filter((it) => it.sku)
    .map((it) => ({
      id: it.id,
      skuId: it.sku_id,
      nombre: it.sku!.producto?.nombre ?? "SKU eliminado",
      marcaNombre: it.sku!.producto?.marca?.nombre ?? null,
      presentacion: presentacionLabel(it.sku!),
      cantidadVendida: it.cantidad,
      cantidadYaDevuelta: yaDevueltoPorItem.get(it.id) ?? 0,
      precioUnitario: it.precio_unitario,
    }))
    .filter((it) => it.cantidadVendida - it.cantidadYaDevuelta > 0);

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-text">
          Devolución — {(venta.sucursal as unknown as { nombre: string } | null)?.nombre}
        </h1>
        <Link href="/vender/devoluciones" className="text-[12.5px] text-text-2 hover:text-text">
          ← Buscar otra venta
        </Link>
      </div>

      <DevolucionForm
        ventaId={venta.id}
        items={ventaItems}
        skus={(skusRaw ?? []) as unknown as SkuCatalogo[]}
      />
    </div>
  );
}
