import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { formatoMoneda } from "../../_lib/formato";
import { formatoFechaHora } from "@/app/(app)/compras/_lib/formato";
import { FacturarForm, type CondicionIvaOption } from "./_components/facturar-form";
import { VerificarArcaButton } from "./_components/verificar-arca-button";
import { obtenerClientesFrecuentes } from "../actions";

type SkuInfo = SkuPresentacion & {
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type VentaItemFila = {
  id: string;
  cantidad: number;
  precio_unitario: number;
  sku: SkuInfo | null;
};

type Comprobante = {
  id: string;
  tipo_cbte: string;
  numero_comprobante: number | null;
  cae: string | null;
  vencimiento_cae: string | null;
  estado: string;
  motivo_rechazo: string | null;
  qr_data: string | null;
  cuit_receptor: string | null;
  razon_social_receptor: string | null;
};

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

export default async function FacturarVentaPage({
  params,
}: {
  params: Promise<{ ventaId: string }>;
}) {
  const { ventaId } = await params;
  const supabase = await createClient();

  const { data: venta } = await supabase
    .from("ventas")
    .select(
      "id, sucursal_id, fecha, medio_pago, subtotal, descuentos, deposito_envases, total, sucursal:sucursales ( nombre )",
    )
    .eq("id", ventaId)
    .maybeSingle<{
      id: string;
      sucursal_id: string;
      fecha: string;
      medio_pago: string;
      subtotal: number;
      descuentos: number;
      deposito_envases: number;
      total: number;
      sucursal: { nombre: string } | null;
    }>();

  if (!venta) notFound();

  const puedeFacturar = await operaSucursal(supabase, venta.sucursal_id);
  if (!puedeFacturar) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés permiso para facturar ventas de esta sucursal.
      </div>
    );
  }

  const [{ data: itemsRaw }, { data: comprobante }, { data: condicionesRaw }, clientesFrecuentes] =
    await Promise.all([
      supabase
        .from("venta_items")
        .select(
          `id, cantidad, precio_unitario,
         sku:skus ( id, nombre, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
           producto:productos ( nombre, marca:marcas ( nombre ) ) )`,
        )
        .eq("venta_id", ventaId),
      supabase
        .from("comprobantes_fiscales")
        .select(
          "id, tipo_cbte, numero_comprobante, cae, vencimiento_cae, estado, motivo_rechazo, qr_data, cuit_receptor, razon_social_receptor",
        )
        .eq("venta_id", ventaId)
        .maybeSingle<Comprobante>(),
      supabase.from("condicion_iva").select("id, nombre").order("nombre"),
      obtenerClientesFrecuentes(),
    ]);

  const items = ((itemsRaw ?? []) as unknown as VentaItemFila[]).filter((it) => it.sku);
  const importeFacturable = venta.subtotal - venta.descuentos;
  const condiciones: CondicionIvaOption[] = (condicionesRaw ?? []) as CondicionIvaOption[];

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-text">Facturar venta — {venta.sucursal?.nombre ?? ""}</h1>
        <Link href="/vender/facturar" className="text-[12.5px] text-text-2 hover:text-text">
          ← Buscar otra venta
        </Link>
      </div>

      <div className="mb-4 rounded-card border border-border bg-bg p-4">
        <p className="mb-3 text-[12px] text-text-3">
          {formatoFechaHora.format(new Date(venta.fecha))} · {MEDIO_LABEL[venta.medio_pago] ?? venta.medio_pago}
        </p>

        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between border-b border-[#F1F1F3] pb-2 text-[13px] last:border-b-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-text">{it.sku!.producto?.nombre ?? "SKU eliminado"}</p>
                <p className="text-[11.5px] text-text-3">
                  {it.sku!.producto?.marca?.nombre} — {presentacionLabel(it.sku!)} · {it.cantidad} ×{" "}
                  {formatoMoneda.format(it.precio_unitario)}
                </p>
              </div>
              <span className="shrink-0 tabular-nums text-text">
                {formatoMoneda.format(it.cantidad * it.precio_unitario)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1 border-t border-border pt-3 text-[12.5px]">
          <div className="flex justify-between text-text-2">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatoMoneda.format(venta.subtotal)}</span>
          </div>
          {venta.descuentos > 0 && (
            <div className="flex justify-between text-text-2">
              <span>Descuentos</span>
              <span className="tabular-nums">-{formatoMoneda.format(venta.descuentos)}</span>
            </div>
          )}
          {venta.deposito_envases > 0 && (
            <div className="flex justify-between text-text-3">
              <span>Depósito de envases (no se factura)</span>
              <span className="tabular-nums">{formatoMoneda.format(venta.deposito_envases)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 text-[13.5px] font-semibold text-text">
            <span>Importe a facturar</span>
            <span className="tabular-nums">{formatoMoneda.format(importeFacturable)}</span>
          </div>
        </div>
      </div>

      {comprobante?.estado === "autorizado" ? (
        <div className="rounded-card border border-ok/30 bg-ok-bg p-4">
          <p className="text-[13px] font-semibold text-ok">
            Factura {comprobante.tipo_cbte} N° {comprobante.numero_comprobante} — autorizada
          </p>
          <p className="mt-1 text-[12.5px] text-text-2">
            CAE {comprobante.cae} · Vencimiento {comprobante.vencimiento_cae}
          </p>
          {comprobante.razon_social_receptor && (
            <p className="mt-1 text-[12.5px] text-text-2">
              {comprobante.razon_social_receptor} — CUIT {comprobante.cuit_receptor}
            </p>
          )}
          {comprobante.qr_data && (
            <a
              href={comprobante.qr_data}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[12.5px] text-moe hover:underline"
            >
              Ver QR del comprobante →
            </a>
          )}
          <VerificarArcaButton ventaId={ventaId} />
        </div>
      ) : (
        <div className="rounded-card border border-border bg-bg p-4">
          {comprobante && (comprobante.estado === "rechazado" || comprobante.estado === "error") && (
            <div className="mb-3 rounded-[6px] bg-err-bg px-3 py-2 text-[12.5px] text-err">
              {comprobante.estado === "rechazado" ? "ARCA rechazó el intento anterior" : "Error en el intento anterior"}
              {comprobante.motivo_rechazo ? `: ${comprobante.motivo_rechazo}` : ""}. Podés reintentar.
            </div>
          )}

          {condiciones.length === 0 ? (
            <p className="text-[13px] text-text-2">
              Todavía no se sincronizó el catálogo de condiciones de IVA de ARCA.{" "}
              <Link href="/vender/facturar/configuracion" className="text-moe hover:underline">
                Sincronizalo desde Configuración
              </Link>{" "}
              antes de facturar.
            </p>
          ) : (
            <FacturarForm ventaId={ventaId} condiciones={condiciones} clientesFrecuentes={clientesFrecuentes} />
          )}
        </div>
      )}
    </div>
  );
}
