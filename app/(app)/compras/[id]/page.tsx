import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PinProvider } from "@/app/(app)/_components/pin-gate";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { esDueno } from "@/lib/permisos";
import {
  CompraDetalle,
  type CompraDetalleData,
  type ReclasificacionCompra,
  type RecepcionDetalle,
} from "../_components/compra-detalle";
import type { CompraPago } from "../_lib/pagos";

export default async function CompraDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: compra } = await supabase
    .from("compras")
    .select(
      `id, numero_factura, fecha_factura, estado, total,
       tipo_comprobante, neto_gravado, iva, impuestos_internos, percepcion_iva, percepcion_iibb, flete,
       visto_dueno_en,
       proveedor:proveedores ( id, razon_social, nombre_comercial, plazo_dias ),
       compra_items (
         id, sku_id, cantidad, costo_unitario, costo_con_impuestos, subtotal, fecha_vencimiento,
         sku:skus ( nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
                    producto:productos ( nombre, marca:marcas ( nombre ),
                                         categoria:categorias ( alicuota_iva ) ) )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!compra) notFound();

  const esDuenoActual = await esDueno(supabase);

  // Primera vez que el dueño abre esta boleta: se apaga la marca "Nueva" de
  // la lista. No hace nada si ya estaba vista, ni si quien mira no es el
  // dueño (marcar_compra_vista() lo valida igual en la base).
  if (esDuenoActual) {
    await supabase.rpc("marcar_compra_vista", { p_id: id });
  }

  const [{ data: recepciones }, { data: reclasificaciones }, { data: pagos }] = await Promise.all([
    traerTodo(
      supabase
        .from("recepciones_compra")
        .select(
          `id, fecha, estado, usuario:usuarios ( nombre ),
           recepcion_items ( compra_item_id, cantidad_recibida, diferencia, motivo_diferencia )`,
        )
        .eq("compra_id", id)
        .order("fecha", { ascending: true }),
    ),
    traerTodo(
      supabase
        .from("compras_reclasificacion_fiscal")
        .select(
          "id, tipo_anterior, tipo_nuevo, numero_nuevo, fecha_nueva, iva_nuevo, flete_anterior, flete_nuevo, motivo, fecha, usuario:usuarios ( nombre )",
        )
        .eq("compra_id", id)
        .order("fecha", { ascending: false }),
    ),
    // Privado del dueño (pedido del usuario 2026-10-30): a Olavarría ni se
    // le pide -- RLS lo bloquearía de todos modos.
    esDuenoActual
      ? traerTodo(
          supabase
            .from("compra_pagos")
            .select("id, compra_id, tipo, monto, medio_pago, nota, pago_original_id, fecha, usuario:usuarios ( nombre )")
            .eq("compra_id", id)
            .order("fecha", { ascending: true }),
        )
      : Promise.resolve({ data: [] }),
  ]);

  const recepcionesList = (recepciones ?? []) as unknown as RecepcionDetalle[];

  const recibidoPorItem = new Map<string, number>();
  for (const r of recepcionesList) {
    if (r.estado !== "recibida") continue;
    for (const it of r.recepcion_items) {
      recibidoPorItem.set(
        it.compra_item_id,
        (recibidoPorItem.get(it.compra_item_id) ?? 0) + it.cantidad_recibida,
      );
    }
  }

  const compraRaw = compra as unknown as Omit<CompraDetalleData, "items">;
  const itemsRaw = (compra as unknown as { compra_items: CompraDetalleData["items"] }).compra_items ?? [];

  const items = itemsRaw.map((it) => {
    const recibidoPrevio = recibidoPorItem.get(it.id) ?? 0;
    return { ...it, recibido_previo: recibidoPrevio, pendiente: it.cantidad - recibidoPrevio };
  });

  return (
    <PinProvider>
      <CompraDetalle
        compra={{ ...compraRaw, items }}
        recepciones={recepcionesList}
        reclasificaciones={(reclasificaciones ?? []) as unknown as ReclasificacionCompra[]}
        // Cargar la factura que llegó después es carga de mercadería, no
        // lectura: el dueño mira, la encargada corrige.
        puedeReclasificar={!esDuenoActual && compraRaw.estado !== "borrador"}
        // El pago de la boleta es privado del dueño (pedido del usuario
        // 2026-10-30): a Olavarría no se le muestra ni esta sección.
        esDueno={esDuenoActual}
        pagos={(pagos ?? []) as unknown as CompraPago[]}
      />
    </PinProvider>
  );
}
