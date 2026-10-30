import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { esDueno } from "@/lib/permisos";
import { ComprasTable, type Compra } from "./_components/compras-table";
import type { TipoPago } from "./_lib/pagos";

export default async function ComprasPage() {
  const supabase = await createClient();

  const esDuenoActual = await esDueno(supabase);

  // El historial de pagos (y por lo tanto el estado "pagada/parcial/impaga")
  // es privado del dueño (pedido del usuario 2026-10-30): a Olavarría ni se
  // le pide. RLS lo bloquearía igual, pero no tiene sentido pedir un dato
  // que no se va a mostrar.
  const [{ data: compras }, { data: pagos }] = await Promise.all([
    traerTodo(
      supabase
        .from("compras")
        .select(
          `id, numero_factura, fecha_factura, estado, total,
           tipo_comprobante, neto_gravado, iva, impuestos_internos, percepcion_iva, percepcion_iibb, flete,
           visto_dueno_en,
           proveedor:proveedores ( razon_social, nombre_comercial )`,
        )
        .order("fecha_factura", { ascending: false, nullsFirst: false }),
    ),
    esDuenoActual
      ? traerTodo(supabase.from("compra_pagos").select("compra_id, tipo, monto"))
      : Promise.resolve({ data: [] as { compra_id: string; tipo: TipoPago; monto: number }[] }),
  ]);

  const pagosPorCompraId = new Map<string, { tipo: TipoPago; monto: number }[]>();
  for (const p of pagos ?? []) {
    const lista = pagosPorCompraId.get(p.compra_id) ?? [];
    lista.push({ tipo: p.tipo, monto: p.monto });
    pagosPorCompraId.set(p.compra_id, lista);
  }

  const comprasConPagos = (compras ?? []).map((c) => ({
    ...c,
    pagos: esDuenoActual ? pagosPorCompraId.get(c.id) ?? [] : null,
  }));

  return (
    <ComprasTable
      compras={comprasConPagos as unknown as Compra[]}
      puedeCargar={!esDuenoActual}
      esDueno={esDuenoActual}
    />
  );
}
