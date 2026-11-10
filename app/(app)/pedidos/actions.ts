"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { verificarPinOperaciones } from "@/lib/pin";
import { esDueno, operaCentral, operaSucursal } from "@/lib/permisos";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { fechaOperativa } from "@/lib/fecha";
import { enviadoPorSku, limitesDeRango, vendidoPorSku } from "./_lib/vendido";

export type LineaPedido = {
  sku_id: string;
  cantidad: number;
  cantidad_sugerida_sistema: number | null;
  observacion_encargado: string | null;
};

function validarLineasPedido(lineas: LineaPedido[]): string | null {
  if (lineas.length === 0) return "Agregá al menos un producto.";
  for (const l of lineas) {
    if (!l.sku_id) return "Falta seleccionar el SKU en alguna línea.";
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0)
      return "La cantidad tiene que ser un entero mayor a cero.";
  }
  return null;
}

export type SugerenciaSkuDTO = {
  sku_id: string;
  stock_actual: number;
  en_transito: number;
  pendiente_pedidos_abiertos: number;
  stock_objetivo: number;
  arrastre: number;
  sugerido: number;
  vendido_desde_ultimo_envio: number;
  // Stock que hay hoy en Olavarría: lo máximo que se le puede mandar a
  // Laprida con el despacho directo.
  stock_origen: number;
  sku: {
    codigo_interno: string;
    tipo_presentacion: "unidad" | "pack" | "cajon" | "estuche";
    volumen: number;
    unidad_volumen: string;
    unidades_contenidas: number;
    producto: { nombre: string; marca: { nombre: string } | null } | null;
  };
};

// Vendido en Laprida entre dos días (pedido del usuario 2026-11-09: elegir
// "desde cuándo hasta cuándo", ej. lunes a lunes). Los dos días son
// inclusivos y se toman como días de Argentina, no del servidor (ver
// lib/fecha.ts): del 00:00 del "desde" hasta el final del "hasta".
export async function obtenerVendidoPorRango(
  pin: string,
  desde: string,
  hasta: string,
): Promise<{ error: string } | { vendido: Record<string, number> }> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const limites = limitesDeRango(desde, hasta);
  if ("error" in limites) return limites;

  const supabase = await createClient();

  const { data: laprida } = await supabase.from("sucursales").select("id").eq("es_central", false).single();
  if (!laprida) return { error: "No se encontró la sucursal Laprida." };

  if (!(await operaSucursal(supabase, laprida.id)) && !(await operaCentral(supabase))) {
    return { error: "No tenés permiso para ver las ventas de Laprida." };
  }

  const mapa = await vendidoPorSku(supabase, laprida.id, limites.desdeIso, limites.hastaIso);
  return { vendido: Object.fromEntries(mapa) };
}

// Trae todo lo que necesita /pedidos/nuevo (sugerencia + ventas de Laprida
// desde el último envío) detrás del PIN de operaciones (pedido del usuario
// 2026-11-05: "hay datos sensibles"). A diferencia del resto de las
// pantallas con PIN, acá el PIN no solo frena un botón de guardar: frena
// que los datos se traigan del servidor. Por eso /pedidos/nuevo/page.tsx
// ya no hace el fetch directo -- lo pide esta acción, recién cuando llega
// un PIN correcto.
export async function obtenerSugerenciaPedido(pin: string): Promise<
  | { error: string }
  | {
      filas: SugerenciaSkuDTO[];
      ultimoDespacho: string | null;
      puedeDespachar: boolean;
      hoy: string;
    }
> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const supabase = await createClient();

  const [{ data: laprida }, { data: central }] = await Promise.all([
    supabase.from("sucursales").select("id").eq("es_central", false).single(),
    supabase.from("sucursales").select("id").eq("es_central", true).single(),
  ]);
  if (!laprida || !central) return { error: "No se encontraron las sucursales." };

  if (!(await operaSucursal(supabase, laprida.id)) && !(await operaCentral(supabase))) {
    return { error: "No tenés permiso para ver el pedido semanal de Laprida." };
  }

  // Despachar directo lo hace Olavarría, no Laprida ni el dueño (el dueño
  // solo visualiza, mismo criterio que /pedidos).
  const puedeDespachar = (await operaSucursal(supabase, central.id)) && !(await esDueno(supabase));

  const [{ data: sugerencias }, { data: skus }, { data: ultimaTransferencia }, { data: stockCentral }] =
    await Promise.all([
      supabase.rpc("sugerir_pedido", { p_sucursal_destino_id: laprida.id }),
      traerTodo(
        supabase
          .from("skus")
          .select(
            `id, codigo_interno, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
             producto:productos ( nombre, marca:marcas ( nombre ) )`,
          )
          .eq("activo", true),
      ),
      supabase
        .from("transferencias")
        .select("fecha_despacho")
        .eq("sucursal_destino_id", laprida.id)
        .order("fecha_despacho", { ascending: false })
        .limit(1)
        .maybeSingle(),
      traerTodo(
        supabase.from("stock_sucursal").select("sku_id, cantidad").eq("sucursal_id", central.id),
        ["sku_id", "sucursal_id"],
      ),
    ]);

  const ultimoDespacho = ultimaTransferencia?.fecha_despacho ?? null;

  // Vendido en Laprida desde el último envío (o todo el historial, si
  // todavía no se despachó nunca) -- pedido del usuario 2026-11-05: la
  // encargada de Olavarría necesita saber qué se vendió, no solo cuánto
  // stock queda, para decidir qué mandar. Desde 2026-11-09 la pantalla
  // permite cambiar el rango (ver obtenerVendidoPorRango); este es el valor
  // inicial.
  const vendidoInicial = await vendidoPorSku(supabase, laprida.id, ultimoDespacho, null);
  const stockOrigenPorSku = new Map((stockCentral ?? []).map((r) => [r.sku_id, r.cantidad]));

  type Sugerencia = {
    sku_id: string;
    stock_actual: number;
    en_transito: number;
    pendiente_pedidos_abiertos: number;
    stock_objetivo: number;
    arrastre: number;
    sugerido: number;
  };

  const skuPorId = new Map((skus ?? []).map((s) => [s.id, s]));

  const filas: SugerenciaSkuDTO[] = ((sugerencias ?? []) as Sugerencia[])
    .map((s) => {
      const sku = skuPorId.get(s.sku_id);
      if (!sku) return null;
      return {
        ...s,
        vendido_desde_ultimo_envio: vendidoInicial.get(s.sku_id) ?? 0,
        stock_origen: stockOrigenPorSku.get(s.sku_id) ?? 0,
        sku: sku as unknown as SugerenciaSkuDTO["sku"],
      };
    })
    .filter((f): f is SugerenciaSkuDTO => f !== null);

  filas.sort((a, b) => {
    const marcaA = a.sku.producto?.marca?.nombre ?? "";
    const marcaB = b.sku.producto?.marca?.nombre ?? "";
    if (marcaA !== marcaB) return marcaA.localeCompare(marcaB, "es");

    const productoA = a.sku.producto?.nombre ?? "";
    const productoB = b.sku.producto?.nombre ?? "";
    if (productoA !== productoB) return productoA.localeCompare(productoB, "es");

    return a.sku.unidades_contenidas - b.sku.unidades_contenidas;
  });

  return { filas, ultimoDespacho, puedeDespachar, hoy: fechaOperativa() };
}

export async function crearPedido(
  lineas: LineaPedido[],
  enviar: boolean,
): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  const errorLineas = validarLineasPedido(lineas);
  if (errorLineas) return { error: errorLineas };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No hay sesión activa." };

  const [{ data: central }, { data: laprida }] = await Promise.all([
    supabase.from("sucursales").select("id").eq("es_central", true).single(),
    supabase.from("sucursales").select("id").eq("es_central", false).single(),
  ]);
  if (!central || !laprida) return { error: "No se encontraron las sucursales." };

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      sucursal_origen_id: central.id,
      sucursal_destino_id: laprida.id,
      usuario_creador_id: user.id,
    })
    .select("id")
    .single();

  if (pedidoError || !pedido) {
    return { error: pedidoError?.message ?? "No se pudo crear el pedido." };
  }

  const { error: itemsError } = await supabase.from("pedido_items").insert(
    lineas.map((l) => ({
      pedido_id: pedido.id,
      sku_id: l.sku_id,
      cantidad_solicitada: l.cantidad,
      cantidad_sugerida_sistema: l.cantidad_sugerida_sistema,
      observacion_encargado: l.observacion_encargado,
    })),
  );

  if (itemsError) return { error: itemsError.message };

  if (enviar) {
    const { error: enviarError } = await supabase
      .from("pedidos")
      .update({ estado: "enviado" })
      .eq("id", pedido.id);
    if (enviarError) return { error: enviarError.message };
  }

  revalidatePath("/pedidos");
  return { id: pedido.id };
}

// Despacho directo de Olavarría a Laprida (pedido del usuario 2026-11-09):
// arma el envío mirando lo vendido y lo manda en el momento, sin que Laprida
// lo haya pedido. Descuenta Olavarría ya mismo (queda en tránsito) y el
// stock de Laprida recién sube cuando ella confirma la recepción. Todo el
// trabajo lo hace despachar_directo() en una sola transacción: acá no se
// toca stock. Lleva PIN como las demás operaciones que mueven stock.
export async function despacharDirecto(
  lineas: LineaPedido[],
  observaciones: string | null,
  pin: string,
): Promise<{ error: string } | { id: string }> {
  const pinOk = verificarPinOperaciones(pin);
  if ("error" in pinOk) return pinOk;

  const errorLineas = validarLineasPedido(lineas);
  if (errorLineas) return { error: errorLineas };

  const supabase = await createClient();

  if (await esDueno(supabase)) {
    return { error: "El dueño solo visualiza: el envío lo despacha la encargada de Olavarría." };
  }

  const { data, error } = await supabase.rpc("despachar_directo", {
    p_lineas: lineas.map((l) => ({
      sku_id: l.sku_id,
      cantidad: l.cantidad,
      cantidad_sugerida_sistema: l.cantidad_sugerida_sistema,
    })),
    p_observaciones: observaciones,
  });
  if (error) return { error: error.message };

  const pedidoId = (data as { pedido_id?: string } | null)?.pedido_id;
  if (!pedidoId) return { error: "Se despachó, pero no pudimos abrir el pedido. Buscalo en Pedidos." };

  revalidatePath("/pedidos");
  revalidatePath("/productos");
  return { id: pedidoId };
}

export async function enviarPedido(pedidoId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("pedidos").update({ estado: "enviado" }).eq("id", pedidoId);
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  return { ok: true };
}

export async function eliminarPedido(pedidoId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("pedidos").delete().eq("id", pedidoId);
  if (error) return { error: error.message };

  revalidatePath("/pedidos");
  return { ok: true };
}

export type LineaAvancePreparacion = { pedido_item_id: string; cantidad: number };

export async function guardarAvancePreparacion(
  pedidoId: string,
  lineas: LineaAvancePreparacion[],
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("guardar_avance_preparacion", {
    p_pedido_id: pedidoId,
    p_lineas: lineas,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  return { ok: true };
}

export async function confirmarPreparacion(
  pedidoId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("confirmar_preparacion", { p_pedido_id: pedidoId });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  return { ok: true };
}

export type LineaDespacho = { pedido_item_id: string; cantidad: number };

export async function despacharPedido(
  pedidoId: string,
  lineas: LineaDespacho[],
  observaciones: string | null,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("despachar_pedido", {
    p_pedido_id: pedidoId,
    p_lineas: lineas,
    p_observaciones: observaciones,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  revalidatePath("/productos");
  return { ok: true };
}

export type LineaRecepcionTransferencia = {
  transferencia_item_id: string;
  cantidad_recibida: number;
  motivo_diferencia: string | null;
};

export async function confirmarRecepcionTransferencia(
  pedidoId: string,
  transferenciaId: string,
  lineas: LineaRecepcionTransferencia[],
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("confirmar_recepcion_transferencia", {
    p_transferencia_id: transferenciaId,
    p_lineas: lineas,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  revalidatePath("/productos");
  return { ok: true };
}

export async function cerrarPedidoManual(
  pedidoId: string,
  motivo: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("cerrar_pedido_manual", {
    p_pedido_id: pedidoId,
    p_motivo: motivo,
  });
  if (error) return { error: error.message };

  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath("/pedidos");
  return { ok: true };
}

// =========================================================
// Pedidos de compra (Olavarría -> dueño): lo que la encargada arma
// semanalmente para que el dueño sepa qué comprarle a los proveedores.
// No mueve stock -- eso entra normal cuando el dueño compre y se cargue
// la recepción en Compras. Ver supabase/migrations/20260909090000.
// =========================================================

export type LineaPedidoCompra = {
  sku_id: string;
  cantidad_sugerida: number;
  cantidad_solicitada: number;
  // A qué proveedor se le pide esta línea y una nota sobre ella (2026-11-10).
  // Los dos son opcionales.
  proveedor_id: string | null;
  nota: string | null;
};

export async function crearPedidoCompra(
  lineas: LineaPedidoCompra[],
  observaciones: string | null = null,
): Promise<{ error: string } | { id: string }> {
  const supabase = await createClient();

  if (lineas.length === 0) return { error: "Agregá al menos un producto." };
  for (const l of lineas) {
    if (!Number.isInteger(l.cantidad_solicitada) || l.cantidad_solicitada <= 0) {
      return { error: "Las cantidades a pedir tienen que ser enteros mayores a cero." };
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No hay sesión activa." };

  const { data: central } = await supabase.from("sucursales").select("id").eq("es_central", true).single();
  if (!central) return { error: "No se encontró la sucursal central." };

  const { data: pedidoCompra, error: pedidoError } = await supabase
    .from("pedidos_compra")
    .insert({
      sucursal_id: central.id,
      usuario_creador_id: user.id,
      observaciones: observaciones?.trim() ? observaciones.trim() : null,
    })
    .select("id")
    .single();

  if (pedidoError || !pedidoCompra) {
    return { error: pedidoError?.message ?? "No se pudo crear el pedido de compra." };
  }

  const { error: itemsError } = await supabase.from("pedidos_compra_items").insert(
    lineas.map((l) => ({
      pedido_compra_id: pedidoCompra.id,
      sku_id: l.sku_id,
      cantidad_sugerida: l.cantidad_sugerida,
      cantidad_solicitada: l.cantidad_solicitada,
      proveedor_id: l.proveedor_id || null,
      nota: l.nota?.trim() ? l.nota.trim() : null,
    })),
  );

  if (itemsError) return { error: itemsError.message };

  revalidatePath("/pedidos");
  return { id: pedidoCompra.id };
}

// Lo vendido en Olavarría y lo que se mandó a Laprida entre dos días, para
// armar el pedido de compra (pedido del usuario 2026-11-10: "todo lo vendido
// en la semana"). Mismos días inclusivos y de Argentina que en el envío a
// Laprida. Sin PIN: son las ventas del propio local de quien arma el pedido.
export async function obtenerMovimientoCompraPorRango(
  desde: string,
  hasta: string,
): Promise<{ error: string } | { vendido: Record<string, number>; aLaprida: Record<string, number> }> {
  const limites = limitesDeRango(desde, hasta);
  if ("error" in limites) return limites;

  const supabase = await createClient();

  const { data: central } = await supabase.from("sucursales").select("id").eq("es_central", true).single();
  if (!central) return { error: "No se encontró la sucursal central." };

  if (!(await operaSucursal(supabase, central.id))) {
    return { error: "No tenés permiso para ver las ventas de Olavarría." };
  }

  const [vendido, aLaprida] = await Promise.all([
    vendidoPorSku(supabase, central.id, limites.desdeIso, limites.hastaIso),
    enviadoPorSku(supabase, central.id, limites.desdeIso, limites.hastaIso),
  ]);

  return { vendido: Object.fromEntries(vendido), aLaprida: Object.fromEntries(aLaprida) };
}

export async function resolverPedidoCompra(
  pedidoCompraId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No hay sesión activa." };

  const { error } = await supabase
    .from("pedidos_compra")
    .update({ estado: "resuelto", fecha_resolucion: new Date().toISOString(), usuario_resolucion_id: user.id })
    .eq("id", pedidoCompraId);

  if (error) return { error: error.message };

  revalidatePath(`/pedidos/compra/${pedidoCompraId}`);
  revalidatePath("/pedidos");
  return { ok: true };
}

export async function eliminarPedidoCompra(
  pedidoCompraId: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error } = await supabase.from("pedidos_compra").delete().eq("id", pedidoCompraId);
  if (error) return { error: error.message };

  revalidatePath("/pedidos");
  return { ok: true };
}
