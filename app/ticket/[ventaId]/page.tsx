import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { configArca } from "@/lib/arca/env";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import { formatoMoneda } from "@/app/(app)/vender/_lib/formato";
import { formatoFechaHora } from "@/app/(app)/compras/_lib/formato";
import { ImprimirBoton } from "../_components/imprimir-boton";

type SkuInfo = SkuPresentacion & {
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type VentaItemFila = {
  id: string;
  cantidad: number;
  precio_unitario: number;
  sku: SkuInfo | null;
};

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

// Página fuera de (app) a propósito: no lleva sidebar ni header, es una
// vista imprimible sola. Igual exige sesión y permiso sobre la sucursal
// de la venta, como cualquier otra pantalla.
export default async function TicketPage({ params }: { params: Promise<{ ventaId: string }> }) {
  const { ventaId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: venta } = await supabase
    .from("ventas")
    .select(
      "id, fecha, medio_pago, subtotal, descuentos, deposito_envases, total, sucursal_id, sucursal:sucursales ( nombre )",
    )
    .eq("id", ventaId)
    .maybeSingle<{
      id: string;
      fecha: string;
      medio_pago: string;
      subtotal: number;
      descuentos: number;
      deposito_envases: number;
      total: number;
      sucursal_id: string;
      sucursal: { nombre: string } | null;
    }>();

  if (!venta) notFound();

  const puedeVer = await operaSucursal(supabase, venta.sucursal_id);
  if (!puedeVer) {
    return (
      <div className="p-6 text-[13px] text-text-2">No tenés permiso para ver el ticket de esta venta.</div>
    );
  }

  const [{ data: itemsRaw }, { data: comprobante }] = await Promise.all([
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
        "tipo_cbte, numero_comprobante, cae, vencimiento_cae, estado, qr_data, cuit_receptor, razon_social_receptor, condicion_iva:condicion_iva ( nombre ), punto_venta:puntos_venta ( numero_arca )",
      )
      .eq("venta_id", ventaId)
      .maybeSingle<{
        tipo_cbte: string;
        numero_comprobante: number | null;
        cae: string | null;
        vencimiento_cae: string | null;
        estado: string;
        qr_data: string | null;
        cuit_receptor: string | null;
        razon_social_receptor: string | null;
        condicion_iva: { nombre: string } | null;
        punto_venta: { numero_arca: number } | null;
      }>(),
  ]);

  const items = ((itemsRaw ?? []) as unknown as VentaItemFila[]).filter((it) => it.sku);
  const facturado = comprobante?.estado === "autorizado";

  const qrImagen =
    facturado && comprobante?.qr_data ? await QRCode.toDataURL(comprobante.qr_data, { width: 160 }) : null;

  // CUIT emisor: solo se necesita si esta venta terminó facturada -- no
  // tiene sentido reventar el ticket de una venta no fiscal porque falte
  // una variable de entorno de ARCA.
  const cuitEmisor = facturado ? configArca().cuit : null;

  return (
    <div className="mx-auto max-w-[380px] p-4 text-[13px] text-text">
      <div className="no-print mb-4 flex justify-end">
        <ImprimirBoton />
      </div>

      <div className="text-center">
        <p className="text-[15px] font-bold">Bebidas Moe</p>
        <p className="text-[12px] text-text-3">{venta.sucursal?.nombre}</p>
        <p className="mt-1 text-[11.5px] text-text-3">{formatoFechaHora.format(new Date(venta.fecha))}</p>
      </div>

      <div className="my-3 border-t border-dashed border-border" />

      <div className="flex flex-col gap-1">
        {items.map((it) => (
          <div key={it.id} className="flex justify-between gap-2">
            <span className="min-w-0">
              {it.cantidad}x {it.sku!.producto?.nombre ?? "SKU eliminado"}
              <span className="block text-[11px] text-text-3">
                {it.sku!.producto?.marca?.nombre} — {presentacionLabel(it.sku!)}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{formatoMoneda.format(it.cantidad * it.precio_unitario)}</span>
          </div>
        ))}
      </div>

      <div className="my-3 border-t border-dashed border-border" />

      <div className="flex flex-col gap-[3px]">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatoMoneda.format(venta.subtotal)}</span>
        </div>
        {venta.descuentos > 0 && (
          <div className="flex justify-between">
            <span>Descuentos</span>
            <span className="tabular-nums">-{formatoMoneda.format(venta.descuentos)}</span>
          </div>
        )}
        {venta.deposito_envases > 0 && (
          <div className="flex justify-between">
            <span>Depósito de envases</span>
            <span className="tabular-nums">{formatoMoneda.format(venta.deposito_envases)}</span>
          </div>
        )}
        <div className="flex justify-between text-[15px] font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatoMoneda.format(venta.total)}</span>
        </div>
        <div className="flex justify-between text-text-3">
          <span>Medio de pago</span>
          <span>{MEDIO_LABEL[venta.medio_pago] ?? venta.medio_pago}</span>
        </div>
      </div>

      <div className="my-3 border-t border-dashed border-border" />

      {facturado ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="font-semibold">
            Factura {comprobante!.tipo_cbte} — Pto. Vta. {comprobante!.punto_venta?.numero_arca ?? "?"} N°{" "}
            {comprobante!.numero_comprobante}
          </p>
          {cuitEmisor && <p className="text-[11.5px] text-text-3">CUIT emisor {cuitEmisor}</p>}
          <p className="text-[11.5px] text-text-3">
            CAE {comprobante!.cae} · Vto. {comprobante!.vencimiento_cae}
          </p>
          {comprobante!.condicion_iva && (
            <p className="text-[11.5px] text-text-3">{comprobante!.condicion_iva.nombre}</p>
          )}
          {comprobante!.razon_social_receptor && (
            <p className="text-[11.5px] text-text-3">
              {comprobante!.razon_social_receptor} — CUIT {comprobante!.cuit_receptor}
            </p>
          )}
          {qrImagen && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrImagen} alt="Código QR del comprobante" width={140} height={140} className="mt-1" />
          )}
        </div>
      ) : (
        <p className="text-center text-[11.5px] text-text-3">
          Comprobante no fiscal — sin CAE de ARCA todavía.
        </p>
      )}
    </div>
  );
}
