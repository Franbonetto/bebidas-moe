"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { configArca } from "@/lib/arca/env";
import {
  consultarComprobante,
  obtenerCondicionesIva,
  obtenerUltimoAutorizado,
  solicitarCae,
  type ItemIva,
} from "@/lib/arca/wsfe";
import { construirQrUrl } from "@/lib/arca/qr";
import { fechaOperativa } from "@/lib/fecha";
import { errorDeCuit, soloDigitos } from "@/lib/cuit";
import { verificarPinOperaciones } from "@/lib/pin";

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

export type ComprobanteEmitido = {
  tipoCbte: "A" | "B";
  numeroComprobante: number;
  cae: string;
  vencimientoCae: string;
};

// Núcleo de la emisión, compartido por el botón "Facturar" (manual, con el
// receptor cargado a mano) y por la facturación automática de las ventas
// que no son en efectivo (2026-10-19). No revalida rutas ni decide nada de
// negocio: recibe el tipo de comprobante y los datos del receptor ya
// resueltos por quien llama.
async function emitirComprobante(
  ventaId: string,
  input: FacturarVentaInput,
): Promise<{ error: string } | { ok: true; comprobante: ComprobanteEmitido }> {
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

  const { data: itemsRaw, error: errorItems } = await traerTodo(
    supabase
      .from("venta_items")
      .select(
        `id, cantidad, precio_unitario, descripcion,
         sku:skus ( nombre, producto:productos ( nombre, categoria:categorias ( alicuota_iva ) ) )`,
      )
      .eq("venta_id", ventaId),
  );

  if (errorItems) return { error: errorItems.message };

  type ItemFila = {
    id: string;
    cantidad: number;
    precio_unitario: number;
    // Producto particular: sin SKU, con la descripción que se tipeó al
    // venderlo. Va a la factura tal cual, al 21% (decisión del usuario
    // 2026-10-07: no tiene categoría de donde sacar la alícuota, y el
    // `?? 21` de abajo ya lo resolvía).
    descripcion: string | null;
    sku: {
      nombre: string;
      producto: { nombre: string; categoria: { alicuota_iva: number } | null } | null;
    } | null;
  };

  const items: ItemFactura[] = ((itemsRaw ?? []) as unknown as ItemFila[]).map((it) => ({
    ventaItemId: it.id,
    descripcion: it.descripcion ?? it.sku?.producto?.nombre ?? it.sku?.nombre ?? "Producto",
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
      fecha: fechaOperativa(),
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

    // El cliente queda en la libreta solo, sin paso extra para la
    // vendedora (pedido del usuario 2026-10-20). Solo si el receptor
    // está identificado: una Factura B a Consumidor Final no tiene
    // cliente que guardar.
    if (input.cuitReceptor && input.razonSocialReceptor) {
      await registrarClienteDeComprobante({
        cuit: input.cuitReceptor,
        razonSocial: input.razonSocialReceptor,
        condicionIvaId: input.condicionIvaReceptorId,
      });
    }

    return {
      ok: true,
      comprobante: {
        tipoCbte: input.tipoCbte,
        numeroComprobante: cbteNro,
        cae: resultado.cae,
        vencimientoCae: resultado.vencimientoCae,
      },
    };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "Error desconocido al facturar";
    const { error } = await guardar({ estado: "error", motivoRechazo: motivo });
    if (error) return { error: error.message };
    return { error: `No se pudo facturar (reintentable): ${motivo}` };
  }
}

export async function facturarVenta(
  ventaId: string,
  input: FacturarVentaInput,
): Promise<{ error: string } | { ok: true }> {
  const resultado = await emitirComprobante(ventaId, input);
  if ("error" in resultado) return { error: resultado.error };

  revalidatePath(`/vender/facturar/${ventaId}`);
  revalidatePath("/vender/facturar");
  return { ok: true };
}

// =========================================================
// Facturación automática de las ventas que no son en efectivo
// =========================================================
//
// Decisión del usuario 2026-10-19, que reemplaza el "la venta no se
// factura sola" de CLAUDE.md y el "Disparo: manual" de
// docs/bloque_arca_facturacion.md (sección 2):
//
//   - Débito, crédito, transferencia y QR dejan rastro bancario, así que
//     esas ventas se facturan legalmente sin esperar que el cliente lo
//     pida. El efectivo sigue como estaba: ticket interno, y factura a
//     mano desde /vender/facturar si la piden.
//   - Pago dividido: si ALGUNO de los medios no es efectivo, se factura la
//     venta entera -- no existe media venta facturada.
//   - Siempre Factura B a Consumidor Final. Si ARCA la rechaza (por
//     ejemplo por el tope de monto sin identificar al comprador), la venta
//     queda sin facturar y se emite a mano con los datos del cliente.
//   - Nada de esto puede voltear la venta: `confirmar_venta()` ya grabó
//     todo antes de que se hable con ARCA, y un fallo acá deja el
//     comprobante en `rechazado`/`error`, reintentable. Sin reintentos
//     silenciosos (docs/bloque_arca_facturacion.md, sección 4).
const MEDIOS_QUE_FACTURAN = ["debito", "credito", "transferencia", "qr"];

export type ResultadoFacturacionAutomatica =
  // `aviso` en null = no correspondía facturar (venta en efectivo): no es
  // un problema, no hay nada que avisarle a la cajera.
  { facturado: false; aviso: string | null } | { facturado: true; comprobante: ComprobanteEmitido };

export async function facturarVentaAutomatica(
  ventaId: string,
): Promise<ResultadoFacturacionAutomatica> {
  const supabase = await createClient();

  const { data: venta } = await supabase
    .from("ventas")
    .select("id, sucursal_id")
    .eq("id", ventaId)
    .maybeSingle<{ id: string; sucursal_id: string }>();

  if (!venta) return { facturado: false, aviso: "No se encontró la venta para facturar" };

  // Reintento del mismo cobro (clave de idempotencia, 2026-10-20): si la
  // request anterior se cortó después de grabar la venta, confirmar_venta()
  // devolvió esa misma venta y acá llegamos de nuevo. Volver a pedirle un
  // CAE a ARCA sería emitir DOS comprobantes de una sola venta -- y el
  // segundo se perdería igual, porque guardar_comprobante_fiscal() rechaza
  // refacturar una venta ya autorizada, pero recién después de que ARCA
  // gastó el número. Así que si la factura ya está, se devuelve esa y el
  // POS reimprime el mismo ticket, con el mismo CAE.
  const { data: previo } = await supabase
    .from("comprobantes_fiscales")
    .select("tipo_cbte, numero_comprobante, cae, vencimiento_cae, estado")
    .eq("venta_id", ventaId)
    .maybeSingle<{
      tipo_cbte: "A" | "B";
      numero_comprobante: number | null;
      cae: string | null;
      vencimiento_cae: string | null;
      estado: string;
    }>();

  if (
    previo?.estado === "autorizado" &&
    previo.numero_comprobante !== null &&
    previo.cae !== null &&
    previo.vencimiento_cae !== null
  ) {
    return {
      facturado: true,
      comprobante: {
        tipoCbte: previo.tipo_cbte,
        numeroComprobante: previo.numero_comprobante,
        cae: previo.cae,
        vencimientoCae: previo.vencimiento_cae,
      },
    };
  }

  const { data: pagosRaw, error: errorPagos } = await traerTodo(
    supabase.from("venta_pagos").select("medio_pago").eq("venta_id", ventaId),
  );
  if (errorPagos) return { facturado: false, aviso: errorPagos.message };

  const pagos = (pagosRaw ?? []) as { medio_pago: string }[];
  if (!pagos.some((p) => MEDIOS_QUE_FACTURAN.includes(p.medio_pago))) {
    return { facturado: false, aviso: null };
  }

  // Sin punto de venta ARCA activo no hay forma de facturar (hoy, Laprida:
  // ver 20260917090000_arca_multisucursal.sql). La venta ya está hecha, así
  // que esto es un aviso, no un error.
  const { data: puntoVenta } = await supabase
    .from("puntos_venta")
    .select("id")
    .eq("sucursal_id", venta.sucursal_id)
    .eq("activo", true)
    .maybeSingle();

  if (!puntoVenta) {
    return {
      facturado: false,
      aviso: "esta sucursal todavía no tiene punto de venta ARCA configurado",
    };
  }

  const { data: condicionesRaw } = await traerTodo(
    supabase.from("condicion_iva").select("id, nombre"),
  );
  const consumidorFinal = ((condicionesRaw ?? []) as { id: string; nombre: string }[]).find((c) =>
    c.nombre.toLowerCase().includes("consumidor final"),
  );

  if (!consumidorFinal) {
    return {
      facturado: false,
      aviso: "falta sincronizar el catálogo de condiciones de IVA de ARCA (Facturar → Configuración)",
    };
  }

  const resultado = await emitirComprobante(ventaId, {
    tipoCbte: "B",
    condicionIvaReceptorId: consumidorFinal.id,
    cuitReceptor: null,
    razonSocialReceptor: null,
  });

  if ("error" in resultado) return { facturado: false, aviso: resultado.error };

  revalidatePath("/vender/facturar");
  return { facturado: true, comprobante: resultado.comprobante };
}

// Libreta de clientes (pedido del usuario 2026-10-20). Reemplaza al
// autocompletado que leía el historial de comprobantes_fiscales: ese no
// dejaba buscar por nombre, no guardaba la condición de IVA, no se podía
// corregir un dato mal escrito y se evaporaba al limpiar comprobantes.
// Ver supabase/migrations/20261020120000_clientes.sql para el alcance:
// es la parte del CRM que hace falta para emitir, nada más.
export type Cliente = {
  id: string;
  cuit: string;
  razonSocial: string;
  condicionIvaId: string;
};

export async function obtenerClientes(): Promise<Cliente[]> {
  const supabase = await createClient();

  const { data } = await traerTodo(
    supabase.from("clientes").select("id, cuit, razon_social, condicion_iva_id").order("razon_social"),
  );

  type Fila = { id: string; cuit: string; razon_social: string; condicion_iva_id: string };
  return ((data ?? []) as Fila[]).map((c) => ({
    id: c.id,
    cuit: c.cuit,
    razonSocial: c.razon_social,
    condicionIvaId: c.condicion_iva_id,
  }));
}

type DatosCliente = { cuit: string; razonSocial: string; condicionIvaId: string };

// Alta o corrección de un cliente, por CUIT. La usan el botón "Guardar
// cliente" del formulario y también la emisión, que guarda solo al
// cliente nuevo que se acaba de facturar (ver registrarClienteDeComprobante).
export async function guardarCliente(
  datos: DatosCliente,
): Promise<{ error: string } | { ok: true; cliente: Cliente }> {
  const cuit = soloDigitos(datos.cuit);
  const errorCuit = errorDeCuit(cuit);
  if (errorCuit) return { error: errorCuit };

  const razonSocial = datos.razonSocial.trim();
  if (!razonSocial) return { error: "Falta la razón social." };
  if (!datos.condicionIvaId) return { error: "Falta la condición de IVA del cliente." };

  const supabase = await createClient();

  const { data: existente } = await supabase
    .from("clientes")
    .select("id")
    .eq("cuit", cuit)
    .maybeSingle<{ id: string }>();

  // Upsert a mano en vez de .upsert(): el insert necesita que
  // `creado_por` lo ponga el default auth.uid() (la política de RLS exige
  // que coincida), y en el update no hay que tocar ni creado_por ni
  // creado_en -- marcan el alta, no la última corrección.
  const fila = { cuit, razon_social: razonSocial, condicion_iva_id: datos.condicionIvaId };

  const { data, error } = existente
    ? await supabase.from("clientes").update(fila).eq("id", existente.id).select("id").single()
    : await supabase.from("clientes").insert(fila).select("id").single();

  if (error) return { error: error.message };

  return {
    ok: true,
    cliente: { id: data.id, cuit, razonSocial, condicionIvaId: datos.condicionIvaId },
  };
}

// Después de emitir un comprobante con receptor identificado, el cliente
// queda en la libreta sin que la vendedora haga ningún paso extra. Es
// "mejor esfuerzo" a propósito: si falla, NO se devuelve error ni se
// toca el comprobante -- la factura ya está emitida y ARCA ya la
// autorizó, sería absurdo mostrar un error por no haber podido guardar
// una agenda.
async function registrarClienteDeComprobante(datos: DatosCliente): Promise<void> {
  try {
    await guardarCliente(datos);
  } catch {
    // Silencio deliberado: ver el comentario de arriba.
  }
}

// El punto de venta ARCA es config fiscal: la edita el dueño o la
// encargada de Olavarría (RLS de puntos_venta: ve_costos(), ampliado en
// 20260911090000_puntos_venta_ve_costos.sql a pedido del dueño). Se
// escribe directo vía RLS, no hay función SECURITY DEFINER de por medio
// (mismo criterio que categorías/recargos).
export async function guardarPuntoVenta(
  sucursalId: string,
  numeroArca: number,
  pin: string,
): Promise<{ error: string } | { ok: true }> {
  // PIN de operaciones (pedido del usuario 2026-10-20). Cambiar el número
  // de punto de venta sin querer manda las facturas al punto de venta
  // equivocado -- que puede ser el de otro sistema que también factura
  // con este CUIT (ver scripts/paso-arca-produccion-2026-10-20/).
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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
export async function sincronizarCondicionesIva(
  pin: string,
): Promise<{ error: string } | { ok: true; cantidad: number }> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

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

