"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { configArca } from "@/lib/arca/env";
import {
  consultarComprobante,
  obtenerCondicionesIva,
  obtenerUltimoAutorizado,
  solicitarCae,
  type ItemIva,
} from "@/lib/arca/wsfe";
import { construirQrUrl } from "@/lib/arca/qr";

// Catálogo de alícuotas de IVA de ARCA (tabla de parámetros fija de WSFEv1,
// no una decisión de negocio nuestra — a diferencia de condicion_iva, no
// hace falta sincronizarla: son los mismos códigos desde que existe el
// servicio). Si algún día se suma una categoría con una alícuota que no
// está acá, esto tiene que fallar fuerte en vez de facturar mal.
const ALICUOTA_A_ID_ARCA: Record<string, number> = {
  "0": 3,
  "10.5": 4,
  "21": 5,
  "27": 6,
  "5": 8,
  "2.5": 9,
};

function idArcaParaAlicuota(alicuota: number): number {
  const id = ALICUOTA_A_ID_ARCA[String(alicuota)];
  if (!id) {
    throw new Error(
      `No hay código ARCA mapeado para la alícuota de IVA ${alicuota}% — agregalo a ALICUOTA_A_ID_ARCA antes de facturar`,
    );
  }
  return id;
}

type ItemFactura = {
  ventaItemId: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  alicuotaIva: number;
};

export type FacturarVentaInput = {
  tipoCbte: "A" | "B";
  condicionIvaReceptorId: string;
  cuitReceptor: string | null;
  razonSocialReceptor: string | null;
};

export async function facturarVenta(
  ventaId: string,
  input: FacturarVentaInput,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { data: venta, error: errorVenta } = await supabase
    .from("ventas")
    .select("id, sucursal_id, estado, subtotal, descuentos")
    .eq("id", ventaId)
    .maybeSingle<{
      id: string;
      sucursal_id: string;
      estado: string;
      subtotal: number;
      descuentos: number;
    }>();

  if (errorVenta) return { error: errorVenta.message };
  if (!venta) return { error: "La venta no existe" };
  if (venta.estado !== "confirmada") return { error: "Solo se pueden facturar ventas confirmadas" };

  if (input.tipoCbte === "A" && (!input.cuitReceptor || !input.razonSocialReceptor)) {
    return { error: "Factura A necesita CUIT y razón social del receptor" };
  }

  const { data: itemsRaw, error: errorItems } = await supabase
    .from("venta_items")
    .select(
      `id, cantidad, precio_unitario,
       sku:skus ( nombre, producto:productos ( nombre, categoria:categorias ( alicuota_iva ) ) )`,
    )
    .eq("venta_id", ventaId);

  if (errorItems) return { error: errorItems.message };

  type ItemFila = {
    id: string;
    cantidad: number;
    precio_unitario: number;
    sku: {
      nombre: string;
      producto: { nombre: string; categoria: { alicuota_iva: number } | null } | null;
    } | null;
  };

  const items: ItemFactura[] = ((itemsRaw ?? []) as unknown as ItemFila[]).map((it) => ({
    ventaItemId: it.id,
    descripcion: it.sku?.producto?.nombre ?? it.sku?.nombre ?? "Producto",
    cantidad: it.cantidad,
    precioUnitario: it.precio_unitario,
    subtotal: it.precio_unitario * it.cantidad,
    alicuotaIva: it.sku?.producto?.categoria?.alicuota_iva ?? 21,
  }));

  if (items.length === 0) return { error: "La venta no tiene items para facturar" };

  // El depósito de envase no es facturación (CLAUDE.md: "no es facturación
  // ni margen, categoría aparte") — el importe facturable excluye
  // ventas.deposito_envases, es solo subtotal - descuentos.
  const importeFacturable = venta.subtotal - venta.descuentos;
  const sumaItems = items.reduce((acc, it) => acc + it.subtotal, 0);
  if (Math.abs(sumaItems - importeFacturable) > 0.01) {
    return {
      error: `Inconsistencia entre el total de la venta ($${importeFacturable.toFixed(2)}) y la suma de sus items ($${sumaItems.toFixed(2)}) — no se factura para no mandar un importe incorrecto a ARCA`,
    };
  }

  const porAlicuota = new Map<number, { base: number; iva: number; total: number }>();
  for (const it of items) {
    const grupo = porAlicuota.get(it.alicuotaIva) ?? { base: 0, iva: 0, total: 0 };
    const base = it.subtotal / (1 + it.alicuotaIva / 100);
    grupo.base += base;
    grupo.iva += it.subtotal - base;
    grupo.total += it.subtotal;
    porAlicuota.set(it.alicuotaIva, grupo);
  }

  let importeNeto = 0;
  let importeIva = 0;
  const iva: ItemIva[] = [];
  for (const [alicuota, grupo] of porAlicuota) {
    importeNeto += grupo.base;
    importeIva += grupo.iva;
    iva.push({ id: idArcaParaAlicuota(alicuota), baseImponible: grupo.base, importe: grupo.iva });
  }

  const { data: puntoVenta, error: errorPunto } = await supabase
    .from("puntos_venta")
    .select("id, numero_arca")
    .eq("sucursal_id", venta.sucursal_id)
    .eq("activo", true)
    .maybeSingle();

  if (errorPunto) return { error: errorPunto.message };
  if (!puntoVenta) {
    return {
      error: "Esta sucursal no tiene un punto de venta ARCA configurado — configuralo antes de facturar",
    };
  }

  const { data: condicionIva, error: errorCondicion } = await supabase
    .from("condicion_iva")
    .select("codigo_arca")
    .eq("id", input.condicionIvaReceptorId)
    .maybeSingle();

  if (errorCondicion) return { error: errorCondicion.message };
  if (!condicionIva) return { error: "Condición de IVA del receptor inválida" };

  const cbteTipo = input.tipoCbte === "A" ? 1 : 6;
  const docTipo = input.cuitReceptor ? 80 : 99;
  const docNro = input.cuitReceptor ?? "0";

  const guardar = (args: {
    estado: "autorizado" | "rechazado" | "error";
    numeroComprobante?: number;
    cae?: string;
    vencimientoCae?: string;
    motivoRechazo?: string;
    qrData?: string;
  }) =>
    supabase.rpc("guardar_comprobante_fiscal", {
      p_venta_id: ventaId,
      p_tipo_cbte: input.tipoCbte,
      p_punto_venta_id: puntoVenta.id,
      p_condicion_iva_receptor_id: input.condicionIvaReceptorId,
      p_cuit_receptor: input.cuitReceptor,
      p_razon_social_receptor: input.razonSocialReceptor,
      p_importe_total: importeFacturable,
      p_importe_neto: importeNeto,
      p_importe_iva: importeIva,
      p_estado: args.estado,
      p_numero_comprobante: args.numeroComprobante ?? null,
      p_cae: args.cae ?? null,
      p_vencimiento_cae: args.vencimientoCae ?? null,
      p_motivo_rechazo: args.motivoRechazo ?? null,
      p_qr_data: args.qrData ?? null,
      p_items: items.map((it) => ({
        venta_item_id: it.ventaItemId,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: it.precioUnitario,
        subtotal: it.subtotal,
      })),
    });

  try {
    const ultimoAutorizado = await obtenerUltimoAutorizado(puntoVenta.numero_arca, cbteTipo);
    const cbteNro = ultimoAutorizado + 1;

    const resultado = await solicitarCae({
      ptoVta: puntoVenta.numero_arca,
      cbteTipo,
      docTipo,
      docNro,
      cbteNro,
      importeTotal: importeFacturable,
      importeNeto,
      importeIva,
      condicionIvaReceptorId: Number(condicionIva.codigo_arca),
      iva,
    });

    if (!resultado.ok) {
      const { error } = await guardar({ estado: "rechazado", motivoRechazo: resultado.motivo });
      if (error) return { error: error.message };
      return { error: `ARCA rechazó el comprobante: ${resultado.motivo}` };
    }

    const { cuit } = configArca();
    const qrData = construirQrUrl({
      fecha: new Date().toISOString().slice(0, 10),
      cuitEmisor: cuit,
      ptoVta: puntoVenta.numero_arca,
      tipoCmp: cbteTipo,
      nroCmp: cbteNro,
      importeTotal: importeFacturable,
      tipoDocReceptor: docTipo,
      nroDocReceptor: docNro,
      cae: resultado.cae,
    });

    const { error: errorGuardar } = await guardar({
      estado: "autorizado",
      numeroComprobante: cbteNro,
      cae: resultado.cae,
      vencimientoCae: resultado.vencimientoCae,
      qrData,
    });
    if (errorGuardar) return { error: errorGuardar.message };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "Error desconocido al facturar";
    const { error } = await guardar({ estado: "error", motivoRechazo: motivo });
    if (error) return { error: error.message };
    return { error: `No se pudo facturar (reintentable): ${motivo}` };
  }

  revalidatePath(`/vender/facturar/${ventaId}`);
  revalidatePath("/vender/facturar");
  return { ok: true };
}

// Clientes frecuentes: no hay CRM todavía (docs/bloque_arca_facturacion.md,
// sección 3, gap conocido) -- en vez de armar una tabla nueva, se reusa el
// historial que YA existe en comprobantes_fiscales (cuit_receptor +
// razon_social_receptor de facturas ya emitidas) para autocompletar el
// formulario y que la vendedora no tenga que volver a tipear los mismos
// datos de un cliente habitual. Es global a las dos sucursales (un cliente
// puede facturar en cualquiera) -- RLS de comprobantes_fiscales ya filtra
// por sucursal, así que esto respeta lo mismo que ve el usuario.
export type ClienteFrecuente = { cuit: string; razonSocial: string; vecesFacturado: number };

export async function obtenerClientesFrecuentes(): Promise<ClienteFrecuente[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("comprobantes_fiscales")
    .select("cuit_receptor, razon_social_receptor")
    .not("cuit_receptor", "is", null)
    .not("razon_social_receptor", "is", null)
    .eq("estado", "autorizado");

  const porCuit = new Map<string, { razonSocial: string; veces: number }>();
  for (const fila of (data ?? []) as { cuit_receptor: string; razon_social_receptor: string }[]) {
    const actual = porCuit.get(fila.cuit_receptor);
    porCuit.set(fila.cuit_receptor, {
      razonSocial: fila.razon_social_receptor,
      veces: (actual?.veces ?? 0) + 1,
    });
  }

  return [...porCuit.entries()]
    .map(([cuit, v]) => ({ cuit, razonSocial: v.razonSocial, vecesFacturado: v.veces }))
    .sort((a, b) => b.vecesFacturado - a.vecesFacturado)
    .slice(0, 100);
}

// El punto de venta ARCA es config fiscal: la edita el dueño o la
// encargada de Olavarría (RLS de puntos_venta: ve_costos(), ampliado en
// 20260911090000_puntos_venta_ve_costos.sql a pedido del dueño). Se
// escribe directo vía RLS, no hay función SECURITY DEFINER de por medio
// (mismo criterio que categorías/recargos).
export async function guardarPuntoVenta(
  sucursalId: string,
  numeroArca: number,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { data: existente, error: errorLectura } = await supabase
    .from("puntos_venta")
    .select("id")
    .eq("sucursal_id", sucursalId)
    .maybeSingle();

  if (errorLectura) return { error: errorLectura.message };

  const { error } = existente
    ? await supabase.from("puntos_venta").update({ numero_arca: numeroArca }).eq("id", existente.id)
    : await supabase.from("puntos_venta").insert({ sucursal_id: sucursalId, numero_arca: numeroArca });

  if (error) return { error: error.message };

  revalidatePath("/vender/facturar/configuracion");
  return { ok: true };
}

// Sincroniza el catálogo de condición de IVA del receptor desde ARCA
// (FEParamGetCondicionIvaReceptor) — botón manual, no automático
// (docs/arquitectura.md 1.8: "no se hardcodea, se sincroniza aparte").
export async function sincronizarCondicionesIva(): Promise<
  { error: string } | { ok: true; cantidad: number }
> {
  const supabase = await createClient();

  let condiciones;
  try {
    condiciones = await obtenerCondicionesIva();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido al sincronizar" };
  }

  const { error } = await supabase
    .from("condicion_iva")
    .upsert(
      condiciones.map((c) => ({ codigo_arca: c.id, nombre: c.nombre, actualizado_en: new Date().toISOString() })),
      { onConflict: "codigo_arca" },
    );

  if (error) return { error: error.message };

  revalidatePath("/vender/facturar/configuracion");
  return { ok: true, cantidad: condiciones.length };
}

// Verifica un comprobante ya autorizado contra el servicio de consulta de
// ARCA (FECompConsultar) -- no alcanza con que quede guardado localmente
// como "autorizado", checklist de testing del bloque.
export async function verificarComprobanteArca(
  ventaId: string,
): Promise<{ error: string } | { ok: true; coincide: boolean; detalle: string }> {
  const supabase = await createClient();

  const { data: comprobante, error: errorComprobante } = await supabase
    .from("comprobantes_fiscales")
    .select(
      "tipo_cbte, numero_comprobante, cae, vencimiento_cae, importe_total, punto_venta:puntos_venta ( numero_arca )",
    )
    .eq("venta_id", ventaId)
    .maybeSingle<{
      tipo_cbte: "A" | "B";
      numero_comprobante: number | null;
      cae: string | null;
      vencimiento_cae: string | null;
      importe_total: number;
      punto_venta: { numero_arca: number } | null;
    }>();

  if (errorComprobante) return { error: errorComprobante.message };
  if (!comprobante || !comprobante.numero_comprobante || !comprobante.punto_venta) {
    return { error: "Esta venta no tiene un comprobante autorizado para verificar" };
  }

  const cbteTipo = comprobante.tipo_cbte === "A" ? 1 : 6;

  try {
    const enArca = await consultarComprobante(
      comprobante.punto_venta.numero_arca,
      cbteTipo,
      comprobante.numero_comprobante,
    );

    const coincide =
      enArca.resultado === "A" &&
      enArca.cae === comprobante.cae &&
      Math.abs(enArca.importeTotal - comprobante.importe_total) < 0.01;

    const detalle = coincide
      ? `ARCA confirma: CAE ${enArca.cae}, vencimiento ${enArca.vencimientoCae}, importe $${enArca.importeTotal.toFixed(2)}.`
      : `Diferencia con lo guardado localmente — ARCA dice: resultado ${enArca.resultado}, CAE ${enArca.cae}, importe $${enArca.importeTotal.toFixed(2)}.`;

    return { ok: true, coincide, detalle };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido al verificar contra ARCA" };
  }
}

// Facturación automática al confirmar una venta, para cualquier sucursal
// con punto de venta ARCA activo: siempre Factura B, Consumidor Final --
// no se le pide nada al cliente en el momento. Si alguien quiere Factura A
// con su CUIT, se hace aparte desde /vender/facturar como ya funciona.
// Pensada para no interrumpir el cobro: quien llama (confirmarVenta)
// ignora el resultado si falla -- la venta ya está confirmada de todos
// modos, y el comprobante queda para reintentar desde /vender/facturar
// igual que cualquier rechazo manual.
export async function facturarVentaAutomatico(
  ventaId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { data: condicion, error: errorCondicion } = await supabase
    .from("condicion_iva")
    .select("id")
    .ilike("nombre", "%consumidor final%")
    .maybeSingle();

  if (errorCondicion) return { error: errorCondicion.message };
  if (!condicion) {
    return { error: "No se sincronizó todavía el catálogo de condiciones de IVA (falta 'Consumidor Final')" };
  }

  return facturarVenta(ventaId, {
    tipoCbte: "B",
    condicionIvaReceptorId: condicion.id,
    cuitReceptor: null,
    razonSocialReceptor: null,
  });
}
