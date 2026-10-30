import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase/traer-todo";
import { esDueno } from "@/lib/permisos";
import type { Compra } from "@/app/(app)/compras/_components/compras-table";
import type { TipoPago } from "@/app/(app)/compras/_lib/pagos";
import type { Proveedor } from "@/app/(app)/proveedores/_components/proveedores-table";
import {
  ProveedorDetalle,
  type AjusteCuentaProveedor,
  type ProductoProveedor,
} from "./_components/proveedor-detalle";

export default async function ProveedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: proveedor } = await supabase
    .from("proveedores")
    .select(
      "id, razon_social, nombre_comercial, cuit, contacto, whatsapp, email, direccion, condicion_pago, plazo_dias, observaciones, activo",
    )
    .eq("id", id)
    .maybeSingle();

  if (!proveedor) notFound();

  const esDuenoActual = await esDueno(supabase);

  const [{ data: compras }, { data: proveedorSkus }, { data: sucursalCentral }] = await Promise.all([
    traerTodo(
      supabase
        .from("compras")
        .select(
          `id, numero_factura, fecha_factura, estado, total,
           tipo_comprobante, neto_gravado, iva, impuestos_internos, percepcion_iva, percepcion_iibb, flete,
           visto_dueno_en`,
        )
        .eq("proveedor_id", id)
        .order("fecha_factura", { ascending: false, nullsFirst: false }),
    ),
    traerTodo(
      supabase
        .from("proveedor_skus")
        .select(
          `sku_id, costo_referencia, activo,
           sku:skus ( id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
                      producto:productos ( nombre, marca:marcas ( nombre ) ) )`,
        )
        .eq("proveedor_id", id),
    ),
    supabase.from("sucursales").select("id, nombre").eq("es_central", true).maybeSingle(),
  ]);

  const compraIds = (compras ?? []).map((c) => c.id);
  const skuIds = (proveedorSkus ?? []).map((ps) => ps.sku_id);

  // El historial de pagos, los ajustes de cuenta y el estado de cada boleta
  // son privados del dueño (pedido del usuario 2026-10-30): a Olavarría ni
  // se le piden -- RLS los bloquearía de todos modos.
  const [{ data: pagos }, { data: ajustes }, { data: stock }] = await Promise.all([
    esDuenoActual && compraIds.length > 0
      ? traerTodoPorLotes(compraIds, (lote) =>
          supabase.from("compra_pagos").select("compra_id, tipo, monto").in("compra_id", lote),
        )
      : Promise.resolve({ data: [] as { compra_id: string; tipo: TipoPago; monto: number }[] }),
    esDuenoActual
      ? traerTodo(
          supabase
            .from("proveedor_ajustes_cuenta")
            .select("id, tipo, monto, nota, fecha, usuario:usuarios ( nombre )")
            .eq("proveedor_id", id)
            .order("fecha", { ascending: false }),
        )
      : Promise.resolve({ data: [] }),
    skuIds.length > 0 && sucursalCentral
      ? traerTodoPorLotes(skuIds, (lote) =>
          supabase
            .from("stock_sucursal")
            .select("sku_id, cantidad")
            .eq("sucursal_id", sucursalCentral.id)
            .in("sku_id", lote),
        )
      : Promise.resolve({ data: [] as { sku_id: string; cantidad: number }[] }),
  ]);

  const pagosPorCompraId = new Map<string, { tipo: TipoPago; monto: number }[]>();
  for (const p of pagos ?? []) {
    const lista = pagosPorCompraId.get(p.compra_id) ?? [];
    lista.push({ tipo: p.tipo, monto: p.monto });
    pagosPorCompraId.set(p.compra_id, lista);
  }

  const comprasConPagos = (compras ?? []).map((c) => ({
    ...c,
    proveedor: { razon_social: proveedor.razon_social, nombre_comercial: proveedor.nombre_comercial },
    visto_dueno_en: c.visto_dueno_en,
    pagos: esDuenoActual ? pagosPorCompraId.get(c.id) ?? [] : null,
  }));

  const stockPorSkuId = new Map<string, number>();
  for (const s of stock ?? []) {
    stockPorSkuId.set(s.sku_id, (stockPorSkuId.get(s.sku_id) ?? 0) + s.cantidad);
  }

  const productos = (proveedorSkus ?? [])
    .map((ps) => {
      const sku = (ps as unknown as { sku: ProductoProveedor["sku"] | null }).sku;
      if (!sku) return null;
      return {
        sku_id: ps.sku_id,
        costo_referencia: ps.costo_referencia,
        activo: ps.activo,
        sku,
        stock: stockPorSkuId.get(ps.sku_id) ?? 0,
      } as ProductoProveedor;
    })
    .filter((p): p is ProductoProveedor => p !== null);

  return (
    <ProveedorDetalle
      proveedor={proveedor as Proveedor}
      compras={comprasConPagos as unknown as Compra[]}
      ajustes={(ajustes ?? []) as unknown as AjusteCuentaProveedor[]}
      productos={productos}
      sucursalCentralNombre={sucursalCentral?.nombre ?? null}
      esDueno={esDuenoActual}
    />
  );
}
