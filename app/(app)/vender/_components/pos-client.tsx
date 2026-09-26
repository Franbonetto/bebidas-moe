"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  resolverTicketEfectivo,
  coincideFragmentos,
  type ComboDef,
  type PromoCantidadDef,
  type Tramo,
} from "@/lib/promociones";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import {
  confirmarVenta,
  desarmarParaVenta,
  registrarMovimientoCaja,
  type ComprobanteResumen,
  type LineaVenta,
  type PagoVenta,
} from "../actions";
import { formatoMoneda } from "../_lib/formato";
import { AbrirCajaForm } from "./abrir-caja-form";

export type SkuPos = {
  id: string;
  nombre: string;
  marcaNombre: string | null;
  codigoInterno: string;
  codigoBarras: string | null;
  presentacion: SkuPresentacion;
  esRetornable: boolean;
  valorDeposito: number;
  // El SKU que se desarma EN este (ej. para la lata, el pack x6). Null si
  // nada se desarma en este SKU.
  padreDesarme: { id: string; cantidad: number } | null;
  stock: number;
  precioEfectivo: number | null;
  precioOtroMedio: number | null;
  origen: "excepcion" | "manual" | "recargo" | "sin_precio";
  bajoCostoEfectivo: boolean;
  vendidosUltimos30Dias: number;
};

export type ComboData = ComboDef;
export type PromoCantidadData = PromoCantidadDef;

type MedioPago = "efectivo" | "debito" | "credito" | "transferencia" | "qr";

type LineaTicket = { skuId: string; cantidad: number };

// Pago dividido: hasta 3 medios por venta (ver
// 20260919100000_venta_pagos.sql). Si hay más de un pago, o el único no es
// efectivo, se pierde el precio/descuento de efectivo para toda la venta
// -- decisión de negocio confirmada, no se prorratea por línea.
type Pago = { medioPago: MedioPago; monto: number };

type Ticket = {
  id: string;
  lineas: LineaTicket[];
  envaseChecked: Record<string, boolean>;
  pagos: Pago[];
  // Solo se usan en modoEnvio (ver PosClient) -- uno por ticket, para poder
  // tener más de un pedido de envío en espera con su propio moto/dirección.
  motomandado: string;
  direccionEnvio: string;
};

function ticketVacio(id: string): Ticket {
  return { id, lineas: [], envaseChecked: {}, pagos: [], motomandado: "", direccionEnvio: "" };
}

// Orden pensado para los atajos F1-F5 (pedido del usuario 2026-09-21:
// "F5 poner crédito"). Cantidad se corrió a F6 y Nuevo ticket a F11 para
// hacerle lugar (ver useEffect de atajos globales más abajo).
const MEDIOS: { id: MedioPago; label: string; tecla?: string }[] = [
  { id: "efectivo", label: "Efectivo", tecla: "F1" },
  { id: "qr", label: "QR", tecla: "F2" },
  { id: "debito", label: "Débito", tecla: "F3" },
  { id: "transferencia", label: "Transferencia", tecla: "F4" },
  { id: "credito", label: "Crédito", tecla: "F5" },
];

const ORIGEN_LABEL: Record<Tramo["origen"], string> = {
  combo: "Promo combo",
  cantidad: "Promo cantidad",
  excepcion: "Precio excepción",
  manual: "",
  recargo: "",
  sin_precio: "Sin precio cargado",
};

function textoBusqueda(sku: SkuPos) {
  return `${sku.marcaNombre ?? ""} ${sku.nombre} ${presentacionLabel(sku.presentacion)}`;
}

// "3*código" o "3*nombre" -> cantidad 3. Sin el patrón, cantidad 1 y el
// texto entero se usa para buscar.
function parseQuery(q: string): { cantidad: number; texto: string } {
  const m = q.match(/^(\d+)\*(.+)$/);
  if (m) return { cantidad: Math.max(1, parseInt(m[1], 10)), texto: m[2] };
  return { cantidad: 1, texto: q };
}

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[14.5px] text-text outline-none focus:border-moe";

export function PosClient({
  sucursalId,
  sucursalNombre,
  puedeFacturar,
  skus,
  combos,
  promosCantidad,
  estadoCaja,
  cajaId,
  cantidadTicketsHoy,
  modoEnvio = false,
}: {
  sucursalId: string;
  sucursalNombre: string;
  puedeFacturar: boolean;
  skus: SkuPos[];
  combos: ComboData[];
  promosCantidad: PromoCantidadData[];
  estadoCaja: "sin_abrir" | "abierta" | "cerrada";
  cajaId: string | null;
  cantidadTicketsHoy: number;
  // Envíos (2026-09-21): mismo motor de venta, pero pide motomandado y
  // dirección a mano, nunca factura automático (el ticket impreso tiene
  // que ser siempre el interno, nunca la factura ARCA), y esconde los
  // accesos que no aplican a un pedido para delivery (Facturar,
  // Devoluciones).
  modoEnvio?: boolean;
}) {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>(() => [ticketVacio("1")]);
  const [ticketActivoId, setTicketActivoId] = useState("1");
  const contadorTicketRef = useRef(1);

  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lineaSeleccionada, setLineaSeleccionada] = useState<string | null>(null);
  const [editandoCantidadSkuId, setEditandoCantidadSkuId] = useState<string | null>(null);
  const [cantidadEditada, setCantidadEditada] = useState("");
  const [verPrecioAbierto, setVerPrecioAbierto] = useState(false);
  const [verPrecioQuery, setVerPrecioQuery] = useState("");
  const [movimientoTipo, setMovimientoTipo] = useState<"entrada" | "salida" | null>(null);
  const [movimientoMonto, setMovimientoMonto] = useState("");
  const [movimientoMotivo, setMovimientoMotivo] = useState("");
  const [movimientoError, setMovimientoError] = useState<string | null>(null);
  const [pendingMovimiento, startTransitionMovimiento] = useTransition();

  // Confirmación visible de que la venta se registró: el ticket se limpia
  // solo (para arrancar el siguiente), así que sin esto no queda ningún
  // rastro en pantalla de que la venta anterior se guardó.
  const [ventaConfirmada, setVentaConfirmada] = useState<number | null>(null);
  const [ultimaVenta, setUltimaVenta] = useState<{ id: string; comprobante: ComprobanteResumen | null } | null>(
    null,
  );
  const avisoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mostrarPago, setMostrarPago] = useState(false);
  const primerMedioRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mostrarPago) primerMedioRef.current?.focus();
  }, [mostrarPago]);

  const skuPorId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const ticketActivo = tickets.find((t) => t.id === ticketActivoId) ?? tickets[0];
  const { lineas, envaseChecked, pagos, motomandado, direccionEnvio } = ticketActivo;

  function actualizarTicketActivo(fn: (t: Ticket) => Ticket) {
    setTickets((prev) => prev.map((t) => (t.id === ticketActivoId ? fn(t) : t)));
  }

  function nuevoTicket() {
    contadorTicketRef.current += 1;
    const id = String(contadorTicketRef.current);
    setTickets((prev) => [...prev, ticketVacio(id)]);
    setTicketActivoId(id);
    setLineaSeleccionada(null);
    setQuery("");
    searchInputRef.current?.focus();
  }

  function cerrarTicket(id: string) {
    if (tickets.length <= 1) return;
    const ticket = tickets.find((t) => t.id === id);
    if (ticket && ticket.lineas.length > 0 && !window.confirm("Este ticket tiene productos sin cobrar. ¿Descartarlo?")) {
      return;
    }
    const restantes = tickets.filter((t) => t.id !== id);
    setTickets(restantes);
    if (id === ticketActivoId) setTicketActivoId(restantes[0].id);
  }

  const { texto: textoQuery, cantidad: cantidadQuery } = parseQuery(query);

  const resultados = useMemo(() => {
    const q = textoQuery.trim();
    if (!q) return [];
    const yaEnCarrito = new Set(lineas.map((l) => l.skuId));
    return skus
      .filter((s) => !yaEnCarrito.has(s.id))
      .filter((s) => coincideFragmentos(textoBusqueda(s), q))
      .slice(0, 8);
  }, [skus, lineas, textoQuery]);

  const resultadosVerPrecio = useMemo(() => {
    const q = verPrecioQuery.trim();
    if (!q) return [];
    return skus.filter((s) => coincideFragmentos(textoBusqueda(s), q)).slice(0, 8);
  }, [skus, verPrecioQuery]);

  const accesos = useMemo(
    () =>
      [...skus]
        .filter((s) => s.vendidosUltimos30Dias > 0)
        .sort((a, b) => b.vendidosUltimos30Dias - a.vendidosUltimos30Dias)
        .slice(0, 10),
    [skus],
  );

  function obtenerBase(skuId: string) {
    const sku = skuPorId.get(skuId);
    return {
      precioEfectivo: sku?.precioEfectivo ?? null,
      origen: sku?.origen ?? "sin_precio",
      bajoCosto: sku?.bajoCostoEfectivo ?? false,
    };
  }

  const tramosPorSku = useMemo(
    () => resolverTicketEfectivo(lineas, combos, promosCantidad, obtenerBase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineas, combos, promosCantidad, skus],
  );

  let totalOtroMedio = 0;
  let totalEfectivo = 0;
  let depositoTotal = 0;
  for (const l of lineas) {
    const sku = skuPorId.get(l.skuId);
    if (!sku) continue;
    totalOtroMedio += (sku.precioOtroMedio ?? 0) * l.cantidad;
    if (sku.esRetornable && envaseChecked[l.skuId]) {
      depositoTotal += sku.valorDeposito * l.cantidad;
    }
  }
  for (const tramos of tramosPorSku.values()) {
    for (const t of tramos) totalEfectivo += t.precioUnitario * t.cantidad;
  }
  totalOtroMedio += depositoTotal;
  totalEfectivo += depositoTotal;

  const hayDescuento = Math.round(totalEfectivo) < Math.round(totalOtroMedio);
  const cantidadUnidades = lineas.reduce((acc, l) => acc + l.cantidad, 0);

  // Pago dividido: con más de un medio (o el único no siendo efectivo) se
  // pierde el precio de efectivo para toda la venta -- ver comentario en
  // el tipo Pago. sumaPagos/restante sirven para validar que lo tipeado
  // cierre exacto antes de dejar cobrar.
  const esEfectivoPuro = pagos.length === 1 && pagos[0].medioPago === "efectivo";
  const totalACobrar = esEfectivoPuro ? totalEfectivo : totalOtroMedio;
  const sumaPagos = pagos.reduce((acc, p) => acc + p.monto, 0);
  const restante = Math.round((totalACobrar - sumaPagos) * 100) / 100;

  function agregarSku(sku: SkuPos, cantidad = 1) {
    if (ventaConfirmada != null) {
      if (avisoTimeoutRef.current) clearTimeout(avisoTimeoutRef.current);
      setVentaConfirmada(null);
    }
    actualizarTicketActivo((t) => {
      const idx = t.lineas.findIndex((l) => l.skuId === sku.id);
      let lineas: LineaTicket[];
      if (idx >= 0) {
        lineas = [...t.lineas];
        lineas[idx] = { ...lineas[idx], cantidad: lineas[idx].cantidad + cantidad };
      } else {
        lineas = [...t.lineas, { skuId: sku.id, cantidad }];
      }
      const envaseChecked =
        sku.esRetornable && !(sku.id in t.envaseChecked)
          ? { ...t.envaseChecked, [sku.id]: true }
          : t.envaseChecked;
      return { ...t, lineas, envaseChecked };
    });
    setLineaSeleccionada(sku.id);
    setQuery("");
  }

  function ajustarCantidad(skuId: string, delta: number) {
    actualizarTicketActivo((t) => ({
      ...t,
      lineas: t.lineas.map((l) => (l.skuId === skuId ? { ...l, cantidad: l.cantidad + delta } : l)).filter((l) => l.cantidad > 0),
    }));
  }

  function fijarCantidad(skuId: string, cantidad: number) {
    actualizarTicketActivo((t) => ({
      ...t,
      lineas:
        cantidad > 0
          ? t.lineas.map((l) => (l.skuId === skuId ? { ...l, cantidad } : l))
          : t.lineas.filter((l) => l.skuId !== skuId),
    }));
  }

  function quitarLinea(skuId: string) {
    actualizarTicketActivo((t) => ({ ...t, lineas: t.lineas.filter((l) => l.skuId !== skuId) }));
    setLineaSeleccionada(null);
  }

  function alternarEnvase(skuId: string) {
    actualizarTicketActivo((t) => ({ ...t, envaseChecked: { ...t.envaseChecked, [skuId]: !t.envaseChecked[skuId] } }));
  }

  // Elegir el primer (y hasta ahora único) medio: comportamiento rápido de
  // siempre, un click y ya está el monto completo cargado.
  function elegirMedioUnico(m: MedioPago) {
    const monto = m === "efectivo" ? totalEfectivo : totalOtroMedio;
    actualizarTicketActivo((t) => ({ ...t, pagos: [{ medioPago: m, monto }] }));
  }

  // Agrega un segundo/tercer medio con el resto pendiente ya calculado
  // (con el total "otro medio", porque a partir de acá deja de ser 100%
  // efectivo). La cajera puede después ajustar los montos a mano.
  function agregarMedioAdicional() {
    if (pagos.length === 0 || pagos.length >= 3) return;
    const sumaActual = pagos.reduce((acc, p) => acc + p.monto, 0);
    const restanteAgregar = Math.max(0, Math.round((totalOtroMedio - sumaActual) * 100) / 100);
    const medioLibre = MEDIOS.find((m) => !pagos.some((p) => p.medioPago === m.id))?.id ?? "debito";
    actualizarTicketActivo((t) => ({ ...t, pagos: [...t.pagos, { medioPago: medioLibre, monto: restanteAgregar }] }));
  }

  function quitarMedio(index: number) {
    actualizarTicketActivo((t) => ({ ...t, pagos: t.pagos.filter((_, i) => i !== index) }));
  }

  function cambiarMedioPago(index: number, medio: MedioPago) {
    actualizarTicketActivo((t) => ({
      ...t,
      pagos: t.pagos.map((p, i) => (i === index ? { ...p, medioPago: medio } : p)),
    }));
  }

  function cambiarMontoPago(index: number, monto: number) {
    actualizarTicketActivo((t) => ({
      ...t,
      pagos: t.pagos.map((p, i) => (i === index ? { ...p, monto } : p)),
    }));
  }

  function moverSeleccion(delta: number) {
    if (lineas.length === 0) return;
    const idx = lineas.findIndex((l) => l.skuId === lineaSeleccionada);
    const siguiente = idx < 0 ? 0 : Math.min(lineas.length - 1, Math.max(0, idx + delta));
    setLineaSeleccionada(lineas[siguiente].skuId);
  }

  function abrirEdicionCantidad(skuId: string) {
    const linea = lineas.find((l) => l.skuId === skuId);
    if (!linea) return;
    setEditandoCantidadSkuId(skuId);
    setCantidadEditada(String(linea.cantidad));
  }

  function confirmarEdicionCantidad() {
    if (!editandoCantidadSkuId) return;
    const n = parseInt(cantidadEditada, 10);
    if (Number.isFinite(n) && n > 0) fijarCantidad(editandoCantidadSkuId, n);
    setEditandoCantidadSkuId(null);
  }

  function onScanKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = textoQuery.trim();
    if (!q) {
      // Primer Enter con el campo vacío: abre "¿Cómo paga?" (el segundo
      // Enter que cobra de verdad se maneja a nivel global más abajo,
      // porque el modal le saca el foco a este input apenas se abre).
      if (lineas.length > 0) setMostrarPago(true);
      return;
    }

    const porCodigoBarras = skus.find((s) => s.codigoBarras === q);
    if (porCodigoBarras) {
      agregarSku(porCodigoBarras, cantidadQuery);
      return;
    }
    if (resultados.length === 1) {
      agregarSku(resultados[0], cantidadQuery);
    }
  }

  // Cadena de desarme (arquitectura.md 1.3): sube hasta 2 niveles (pack x6,
  // pack x24) buscando de dónde sacar el faltante. Se encadena sola, el
  // encargado solo aprieta un botón.
  function sugerirDesarme(sku: SkuPos, faltante: number) {
    const padreInfo = sku.padreDesarme;
    if (!padreInfo) return null;
    const padre = skuPorId.get(padreInfo.id);
    if (!padre) return null;

    const necesitaPadre = Math.ceil(faltante / padreInfo.cantidad);

    if (padre.stock >= necesitaPadre) {
      return [{ skuId: padre.id, cantidad: necesitaPadre }];
    }

    const abueloInfo = padre.padreDesarme;
    if (!abueloInfo) return null;
    const abuelo = skuPorId.get(abueloInfo.id);
    if (!abuelo) return null;

    const padreFaltante = necesitaPadre - Math.max(padre.stock, 0);
    const necesitaAbuelo = Math.ceil(padreFaltante / abueloInfo.cantidad);
    if (abuelo.stock >= necesitaAbuelo) {
      return [
        { skuId: abuelo.id, cantidad: necesitaAbuelo },
        { skuId: padre.id, cantidad: necesitaPadre },
      ];
    }
    return null;
  }

  // Se ejecuta solo, sin avisar ni pedir confirmación (decisión del
  // usuario 2026-09-20: en horario de mucha demanda no se pueden detener a
  // clickear nada). Recorre las líneas del ticket en orden; cada
  // desarmar_sku() es atómico y usa el stock real al momento de llamarla,
  // así que si dos líneas del mismo ticket tiran del mismo pack padre, la
  // segunda ya ve el stock actualizado por la primera.
  async function autoDesarmarFaltantes(): Promise<{ error: string } | { ok: true }> {
    for (const l of lineas) {
      const sku = skuPorId.get(l.skuId);
      if (!sku) continue;
      const faltante = Math.max(0, l.cantidad - sku.stock);
      if (faltante <= 0) continue;
      const cadena = sugerirDesarme(sku, faltante);
      if (!cadena) continue;
      const resultado = await desarmarParaVenta(sucursalId, cadena);
      if ("error" in resultado) return resultado;
    }
    return { ok: true };
  }

  function construirLineasVenta(esEfectivoPuro: boolean): LineaVenta[] {
    if (!esEfectivoPuro) {
      return lineas.map((l) => {
        const sku = skuPorId.get(l.skuId);
        const precio = sku?.precioOtroMedio ?? 0;
        return {
          sku_id: l.skuId,
          cantidad: l.cantidad,
          precio_unitario: precio,
          precio_lista_unitario: precio,
          promocion_id: null,
          con_envase: Boolean(sku?.esRetornable && envaseChecked[l.skuId]),
        };
      });
    }

    const resultado: LineaVenta[] = [];
    for (const l of lineas) {
      const sku = skuPorId.get(l.skuId);
      if (!sku) continue;
      const tramos = tramosPorSku.get(l.skuId) ?? [];
      for (const t of tramos) {
        resultado.push({
          sku_id: l.skuId,
          cantidad: t.cantidad,
          precio_unitario: t.precioUnitario,
          precio_lista_unitario: sku.precioOtroMedio ?? t.precioUnitario,
          promocion_id: t.promocionId,
          con_envase: Boolean(sku.esRetornable && envaseChecked[l.skuId]),
        });
      }
    }
    return resultado;
  }

  function confirmar() {
    if (estadoCaja !== "abierta") {
      setError("La caja de hoy ya está cerrada.");
      return;
    }
    if (lineas.length === 0) {
      setError("El ticket no tiene productos.");
      return;
    }
    if (pagos.length === 0) {
      setError("Elegí el medio de pago antes de cobrar.");
      return;
    }
    if (restante !== 0) {
      setError(
        restante > 0
          ? `Faltan ${formatoMoneda.format(restante)} por asignar a algún medio de pago.`
          : `Sobran ${formatoMoneda.format(-restante)}: ajustá los montos para que sumen el total.`,
      );
      return;
    }
    if (modoEnvio && (!motomandado.trim() || !direccionEnvio.trim())) {
      setError("Completá el motomandado y la dirección antes de cobrar.");
      return;
    }
    setError(null);
    const totalCobrado = totalACobrar;
    const pagosVenta: PagoVenta[] = pagos.map((p) => ({ medio_pago: p.medioPago, monto: p.monto }));
    startTransition(async () => {
      const desarme = await autoDesarmarFaltantes();
      if ("error" in desarme) {
        setError(desarme.error);
        return;
      }
      const resultado = await confirmarVenta(
        sucursalId,
        pagosVenta,
        construirLineasVenta(esEfectivoPuro),
        modoEnvio ? { motomandado: motomandado.trim(), direccionEnvio: direccionEnvio.trim() } : undefined,
      );
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }

      const restantes = tickets.filter((t) => t.id !== ticketActivoId);
      if (restantes.length > 0) {
        setTickets(restantes);
        setTicketActivoId(restantes[0].id);
      } else {
        contadorTicketRef.current += 1;
        const nuevoId = String(contadorTicketRef.current);
        setTickets([ticketVacio(nuevoId)]);
        setTicketActivoId(nuevoId);
      }

      setMostrarPago(false);
      setLineaSeleccionada(null);
      setUltimaVenta({ id: resultado.id, comprobante: resultado.comprobante });

      if (avisoTimeoutRef.current) clearTimeout(avisoTimeoutRef.current);
      setVentaConfirmada(totalCobrado);
      avisoTimeoutRef.current = setTimeout(() => setVentaConfirmada(null), 5000);

      router.refresh();
    });
  }

  function abrirMovimientoCaja(tipo: "entrada" | "salida") {
    if (!cajaId) return;
    setMovimientoTipo(tipo);
    setMovimientoMonto("");
    setMovimientoMotivo("");
    setMovimientoError(null);
  }

  function confirmarMovimientoCaja() {
    if (!movimientoTipo || !cajaId) return;
    const monto = Number(movimientoMonto);
    if (!Number.isFinite(monto) || monto <= 0) {
      setMovimientoError("Ingresá un monto válido.");
      return;
    }
    if (!movimientoMotivo.trim()) {
      setMovimientoError("El motivo es obligatorio.");
      return;
    }
    startTransitionMovimiento(async () => {
      const resultado = await registrarMovimientoCaja(cajaId, movimientoTipo, monto, movimientoMotivo.trim());
      if ("error" in resultado) {
        setMovimientoError(resultado.error);
        return;
      }
      setMovimientoTipo(null);
      router.refresh();
    });
  }

  // Atajos globales de teclado -- pensados para que la cajera no tenga que
  // soltar el teclado. F5 se intercepta SIEMPRE (si no, el navegador
  // recarga la página y se pierden los tickets en espera).
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      // Doble Enter para cobrar (pedido del usuario 2026-09-21): el primer
      // Enter (con el buscador vacío, ver onScanKeyDown) abre "¿Cómo
      // paga?"; acá, con el modal ya abierto y un medio+monto que ya
      // cierran, el segundo Enter cobra directo. Va a nivel global (no
      // atado al input) porque el modal le saca el foco al buscador apenas
      // se abre.
      if (e.key === "Enter" && mostrarPago && pagos.length > 0 && restante === 0) {
        e.preventDefault();
        confirmar();
        return;
      }
      if (e.key === "F1" || e.key === "F2" || e.key === "F3" || e.key === "F4" || e.key === "F5") {
        e.preventDefault();
        if (lineas.length === 0) return;
        const medio = {
          F1: "efectivo",
          F2: "qr",
          F3: "debito",
          F4: "transferencia",
          F5: "credito",
        } as const;
        elegirMedioUnico(medio[e.key]);
        return;
      }
      if (e.key === "F6") {
        e.preventDefault();
        if (lineaSeleccionada) abrirEdicionCantidad(lineaSeleccionada);
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        setVerPrecioAbierto(true);
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        nuevoTicket();
        return;
      }
      if (e.key === "F12") {
        e.preventDefault();
        if (lineas.length === 0) return;
        if (pagos.length > 0 && restante === 0) confirmar();
        else setMostrarPago(true);
        return;
      }
      if (e.key === "F7") {
        e.preventDefault();
        abrirMovimientoCaja("entrada");
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        abrirMovimientoCaja("salida");
        return;
      }

      const enCampoTexto = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (enCampoTexto) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        moverSeleccion(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moverSeleccion(-1);
      } else if (e.key === "Delete") {
        e.preventDefault();
        if (lineaSeleccionada) quitarLinea(lineaSeleccionada);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, lineaSeleccionada, pagos, restante, tickets, ticketActivoId, cajaId, mostrarPago]);

  if (estadoCaja === "sin_abrir") {
    return <AbrirCajaForm sucursalId={sucursalId} sucursalNombre={sucursalNombre} />;
  }

  // Selector de medios de pago -- reusado en el panel siempre visible y en
  // el modal "¿Cómo paga?". Arranca mostrando los 4 medios en botones
  // grandes (elige uno, listo); en cuanto hay un pago cargado, cada medio
  // pasa a ser una fila editable con "+ dividir en otro medio" para sumar
  // hasta 3.
  function renderSelectorPagos(refPrimerBoton?: typeof primerMedioRef) {
    if (pagos.length === 0) {
      return (
        <div className="mb-2 grid grid-cols-2 gap-[7px]">
          {MEDIOS.map((m, i) => (
            <button
              key={m.id}
              ref={i === 0 ? refPrimerBoton : undefined}
              type="button"
              onClick={() => elegirMedioUnico(m.id)}
              className="flex items-center justify-between rounded-card border border-border bg-bg px-[8px] py-[8px] text-left text-[14px] font-medium text-text hover:bg-bg-2"
            >
              {m.label}
              {m.tecla && (
                <kbd className="rounded-[4px] border border-border bg-bg-2 px-[5px] py-[1px] text-[12px] font-medium text-text-3">
                  {m.tecla}
                </kbd>
              )}
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="mb-2 flex flex-col gap-[6px]">
        {pagos.map((p, i) => (
          <div key={i} className="flex items-center gap-[6px]">
            <select
              value={p.medioPago}
              onChange={(e) => cambiarMedioPago(i, e.target.value as MedioPago)}
              className="rounded-[6px] border border-border bg-bg px-[6px] py-[5px] text-[14px] text-text outline-none focus:border-moe"
            >
              {MEDIOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {pagos.length === 1 ? (
              <span className="flex-1 text-right text-[14.5px] tabular-nums text-text-2">
                {formatoMoneda.format(p.monto)}
              </span>
            ) : (
              <input
                type="number"
                value={p.monto}
                onChange={(e) => cambiarMontoPago(i, Number(e.target.value) || 0)}
                className="w-[100px] flex-1 rounded-[6px] border border-border bg-bg px-[8px] py-[5px] text-right text-[14.5px] tabular-nums text-text outline-none focus:border-moe"
              />
            )}
            {pagos.length > 1 && (
              <button
                type="button"
                onClick={() => quitarMedio(i)}
                className="shrink-0 text-[14.5px] text-text-3 hover:text-err"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {pagos.length < 3 && (
          <button
            type="button"
            onClick={agregarMedioAdicional}
            className="self-start text-[13.5px] font-medium text-moe hover:underline"
          >
            + Dividir en otro medio
          </button>
        )}

        {pagos.length > 1 && restante !== 0 && (
          <p className={`text-[13.5px] font-medium ${restante > 0 ? "text-warn" : "text-err"}`}>
            {restante > 0
              ? `Falta asignar ${formatoMoneda.format(restante)}`
              : `Sobran ${formatoMoneda.format(-restante)}: ajustá los montos`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-76px)] flex-col sm:h-[calc(100vh-92px)] lg:h-[calc(100vh-24px)]">
      {/* ============ Encabezado + búsqueda + pestañas de ticket ============ */}
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h1 className="text-[17px] font-semibold text-text">
          {modoEnvio ? "Envíos" : "Punto de venta"} — {sucursalNombre}
        </h1>
        <div className="flex gap-2">
          {!modoEnvio && puedeFacturar && (
            <Link
              href="/vender/facturar"
              className="rounded-[6px] border border-border bg-bg px-[10px] py-[4px] text-[13.5px] font-medium text-text-2 hover:bg-bg-2"
            >
              Facturar
            </Link>
          )}
          {!modoEnvio && (
            <Link
              href="/vender/devoluciones"
              className="rounded-[6px] border border-border bg-bg px-[10px] py-[4px] text-[13.5px] font-medium text-text-2 hover:bg-bg-2"
            >
              Devoluciones
            </Link>
          )}
          <Link
            href="/vender/caja"
            className="rounded-[6px] border border-border bg-bg px-[10px] py-[4px] text-[13.5px] font-medium text-text-2 hover:bg-bg-2"
          >
            Caja del día · {cantidadTicketsHoy} ventas
          </Link>
        </div>
      </div>

      {estadoCaja === "cerrada" && (
        <div className="mb-3 shrink-0 rounded-[7px] border border-warn/30 bg-warn-bg px-[12px] py-[10px] text-[14px] text-warn">
          La caja de hoy ya está cerrada. No se pueden registrar más ventas hasta el próximo día.
        </div>
      )}

      {modoEnvio && (
        <div className="mb-3 grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label
              className={`mb-[3px] block text-[12.5px] font-medium ${
                motomandado.trim() ? "text-text-2" : "text-warn"
              }`}
            >
              Motomandado {!motomandado.trim() && "— obligatorio"}
            </label>
            <input
              type="text"
              value={motomandado}
              onChange={(e) => actualizarTicketActivo((t) => ({ ...t, motomandado: e.target.value }))}
              placeholder="Nombre del motomandado"
              className={`w-full rounded-card border bg-bg px-[14px] py-[9px] text-[15px] text-text outline-none focus:border-moe ${
                motomandado.trim() ? "border-border" : "border-warn/60 bg-warn-bg/40"
              }`}
            />
          </div>
          <div>
            <label
              className={`mb-[3px] block text-[12.5px] font-medium ${
                direccionEnvio.trim() ? "text-text-2" : "text-warn"
              }`}
            >
              Dirección {!direccionEnvio.trim() && "— obligatorio"}
            </label>
            <input
              type="text"
              value={direccionEnvio}
              onChange={(e) => actualizarTicketActivo((t) => ({ ...t, direccionEnvio: e.target.value }))}
              placeholder="Dirección de entrega"
              className={`w-full rounded-card border bg-bg px-[14px] py-[9px] text-[15px] text-text outline-none focus:border-moe ${
                direccionEnvio.trim() ? "border-border" : "border-warn/60 bg-warn-bg/40"
              }`}
            />
          </div>
        </div>
      )}

      <div className="mb-3 flex shrink-0 items-stretch gap-2">
        <div className="relative flex-1">
          <input
            ref={searchInputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onScanKeyDown}
            placeholder="Escaneá o escribí el código · 3*código para cantidad · nombre para buscar"
            className="w-full rounded-card border border-border bg-bg px-[14px] py-[11px] text-[16px] text-text outline-none focus:border-moe"
          />
          <span className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2 text-[13px] text-text-3">
            Enter agrega
          </span>
          {resultados.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-[6px] border border-border bg-bg shadow-sm">
              {resultados.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => agregarSku(s, cantidadQuery)}
                  className="flex w-full items-center justify-between border-b border-[#F1F1F3] px-[12px] py-[8px] text-left text-[14.5px] last:border-b-0 hover:bg-bg-2"
                >
                  <span>
                    <span className="font-medium text-text">{s.nombre}</span>
                    <span className="text-text-3">
                      {" "}
                      · {s.marcaNombre} — {presentacionLabel(s.presentacion)}
                    </span>
                  </span>
                  <span className="tabular-nums text-text-2">
                    {s.precioEfectivo != null ? formatoMoneda.format(s.precioEfectivo) : "sin precio"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-card border border-border bg-bg px-[8px]">
          {tickets.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTicketActivoId(t.id);
                setLineaSeleccionada(null);
              }}
              onDoubleClick={() => cerrarTicket(t.id)}
              title={t.lineas.length > 0 ? "Doble click para descartar" : undefined}
              className={`whitespace-nowrap rounded-[6px] px-[10px] py-[7px] text-[14px] font-medium ${
                t.id === ticketActivoId ? "bg-moe-soft text-moe" : "text-text-2 hover:bg-bg-2"
              }`}
            >
              Ticket {i + 1}
              {t.lineas.length > 0 && <span className="ml-1 text-[12px] text-text-3">({t.lineas.length})</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={nuevoTicket}
            title="Nuevo ticket (F11) — dejar este en espera"
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] text-text-2 hover:bg-bg-2"
          >
            +
          </button>
        </div>
      </div>

      {accesos.length > 0 && (
        <div className="mb-3 grid shrink-0 grid-cols-3 gap-[6px] sm:grid-cols-4 md:grid-cols-6">
          {accesos.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => agregarSku(s)}
              className="rounded-[7px] border border-border bg-bg px-[9px] py-[6px] text-left hover:border-border-strong hover:bg-bg-2"
            >
              <b className="block truncate text-[13px] font-medium leading-tight text-text">{s.nombre}</b>
              <small className="tabular-nums text-[12.5px] text-text-3">
                {s.precioEfectivo != null ? formatoMoneda.format(s.precioEfectivo) : "sin precio"}
              </small>
            </button>
          ))}
        </div>
      )}

      {/* ============ Cuerpo: items a la izquierda, total + atajos a la derecha ============ */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex min-h-0 flex-col rounded-card border border-border bg-bg">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-[15px] py-[10px]">
            <h2 className="text-[14.5px] font-semibold text-text">Ticket</h2>
            <span className="text-[13.5px] text-text-3">
              {lineas.length === 0
                ? "Sin productos"
                : `${lineas.length} producto${lineas.length > 1 ? "s" : ""} · ${cantidadUnidades} unidad${cantidadUnidades > 1 ? "es" : ""}`}
            </span>
          </div>

          {ventaConfirmada != null && (
            <div className="mx-[15px] mt-[11px] flex items-center gap-2 rounded-[7px] bg-ok-bg px-[12px] py-[10px] text-[14px] font-medium text-ok">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-[15px] w-[15px] shrink-0"
              >
                <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
              Venta registrada · {formatoMoneda.format(ventaConfirmada)}
            </div>
          )}

          {ultimaVenta && (
            <div className="mx-[15px] mt-[8px] flex items-center justify-between rounded-[7px] border border-border bg-bg-2 px-[12px] py-[9px] text-[13.5px]">
              <span className="text-text-2">
                {ultimaVenta.comprobante
                  ? `Factura ${ultimaVenta.comprobante.tipoCbte} N° ${ultimaVenta.comprobante.numeroComprobante} autorizada`
                  : puedeFacturar
                    ? "Sin facturar todavía (reintentar desde Facturar)"
                    : "Ticket interno"}
              </span>
              <a
                href={`/ticket/${ultimaVenta.id}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-moe hover:underline"
              >
                Imprimir ticket →
              </a>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {lineas.length === 0 ? (
              <div className="p-[40px_20px] text-center text-text-3">
                <p className="mb-1 text-[15px] font-medium text-text-2">Escaneá un producto para empezar</p>
                <p className="text-[14px]">F10 buscar · 3*código cantidad · F11 nuevo ticket</p>
              </div>
            ) : (
              lineas.map((l) => {
                const sku = skuPorId.get(l.skuId);
                if (!sku) return null;
                const tramos = tramosPorSku.get(l.skuId) ?? [];
                const subtotal = tramos.reduce((acc, t) => acc + t.precioUnitario * t.cantidad, 0);
                const faltante = Math.max(0, l.cantidad - sku.stock);
                const sinStock = faltante > 0;
                const seleccionada = l.skuId === lineaSeleccionada;

                return (
                  <div
                    key={l.skuId}
                    onClick={() => setLineaSeleccionada(l.skuId)}
                    className={`cursor-pointer border-b border-[#F1F1F3] px-[15px] py-[10px] ${
                      seleccionada ? "bg-moe-soft/40" : ""
                    }`}
                  >
                    <div className="grid grid-cols-[1fr_auto] items-start gap-x-[10px] gap-y-[4px]">
                      <div className="text-[15px] font-medium leading-tight text-text">
                        {sku.nombre}
                        <small className="mt-[1px] block text-[13px] font-normal text-text-3">
                          {sku.marcaNombre} · {presentacionLabel(sku.presentacion)} · {sku.codigoInterno} ·{" "}
                          <span className={sinStock ? "font-medium text-warn" : ""}>
                            S:{Math.max(sku.stock, 0)}
                          </span>
                        </small>
                      </div>
                      <div className="whitespace-nowrap text-right text-[15px] tabular-nums text-text">
                        {formatoMoneda.format(subtotal)}
                      </div>

                      <div className="col-span-2 mt-[3px] flex flex-wrap items-center gap-[7px]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            ajustarCantidad(l.skuId, -1);
                          }}
                          className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-border text-[14.5px] text-text-2 hover:bg-bg-2"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirEdicionCantidad(l.skuId);
                          }}
                          className="min-w-[26px] rounded-[5px] px-[4px] text-center text-[14.5px] font-medium tabular-nums hover:bg-bg-2"
                          title="Editar cantidad (F6)"
                        >
                          {l.cantidad}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            ajustarCantidad(l.skuId, 1);
                          }}
                          className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-border text-[14.5px] text-text-2 hover:bg-bg-2"
                        >
                          +
                        </button>

                        {sku.esRetornable && (
                          <label
                            className="ml-1 flex items-center gap-1 text-[13px] text-text-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(envaseChecked[l.skuId])}
                              onChange={() => alternarEnvase(l.skuId)}
                            />
                            Con envase
                          </label>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            quitarLinea(l.skuId);
                          }}
                          className="ml-auto text-[13px] text-text-3 hover:text-err"
                        >
                          Quitar
                        </button>
                      </div>

                      {tramos.map((t, i) =>
                        t.origen === "combo" || t.origen === "cantidad" ? (
                          <span
                            key={i}
                            className="col-span-2 mt-[2px] inline-block w-fit rounded-[4px] bg-ok-bg px-[6px] py-[1.5px] text-[12.5px] font-medium text-ok"
                          >
                            {t.cantidad} × {t.promocionNombre ?? ORIGEN_LABEL[t.origen]}
                          </span>
                        ) : null,
                      )}

                      {tramos.some((t) => t.bajoCosto) && (
                        <span className="col-span-2 mt-[2px] inline-block w-fit rounded-[4px] bg-orange-bg px-[6px] py-[1.5px] text-[12.5px] font-medium text-orange">
                          Precio por debajo del costo
                        </span>
                      )}

                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 border-t border-border px-[15px] py-[7px] text-[13px] text-text-3">
            ↑↓ elegir línea · F6 cantidad · Supr borrar
          </div>
        </div>

        {/* ============ Columna derecha: total + atajos ============ */}
        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          <div className="rounded-card border border-border bg-bg p-[14px_15px]">
            {renderSelectorPagos()}

            {depositoTotal > 0 && (
              <div className="mb-[5px] flex justify-between text-[14.5px] text-text-2">
                <span>Depósito de envases</span>
                <span className="tabular-nums">{formatoMoneda.format(depositoTotal)}</span>
              </div>
            )}

            {hayDescuento ? (
              <>
                <div className="mb-[5px] flex items-baseline justify-between">
                  <span className="text-[14.5px] font-medium text-text-2">Total en efectivo</span>
                  <span className="text-[22px] font-semibold tabular-nums text-text">
                    {formatoMoneda.format(totalEfectivo)}
                  </span>
                </div>
                <div className="mb-[9px] flex items-baseline justify-between">
                  <span className="text-[14.5px] font-medium text-text-2">Total en otro medio</span>
                  <span className="text-[17px] font-medium tabular-nums text-text-2">
                    {formatoMoneda.format(totalOtroMedio)}
                  </span>
                </div>
              </>
            ) : (
              <div className="mb-[9px] flex items-baseline justify-between">
                <span className="text-[14.5px] font-medium text-text-2">Total</span>
                <span className="text-[24px] font-semibold tabular-nums text-text">
                  {formatoMoneda.format(totalOtroMedio)}
                </span>
              </div>
            )}

            {error && <p className="mb-2 text-[14px] text-err">{error}</p>}

            <button
              type="button"
              disabled={pending || lineas.length === 0}
              onClick={pagos.length > 0 && restante === 0 ? confirmar : () => setMostrarPago(true)}
              className="w-full rounded-[7px] bg-moe px-[11px] py-[11px] text-[15.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
            >
              {pagos.length > 0 && restante === 0
                ? `Cobrar ${formatoMoneda.format(totalACobrar)}`
                : "Cobrar (F12)"}
            </button>
          </div>

          <div className="rounded-card border border-border bg-bg p-[14px_15px] text-[14px]">
            <div className="grid grid-cols-2 gap-y-[9px]">
              <AtajoItem label="Buscar" tecla="F10" />
              <AtajoItem label="Cantidad" tecla="F6" />
              <AtajoItem label="Nuevo ticket" tecla="F11" />
              <AtajoItem label="Ver precio" tecla="F9" />
              <AtajoItem label="Cobrar" tecla="F12" />
              <AtajoItem label="Quitar" tecla="Supr" />
              <AtajoItem label="Entrada $" tecla="F7" deshabilitado={!cajaId} />
              <AtajoItem label="Salida $" tecla="F8" deshabilitado={!cajaId} />
            </div>
          </div>
        </div>
      </div>

      {/* ============ Modal: medio de pago ============ */}
      {mostrarPago && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setMostrarPago(false)}
        >
          <div className="w-[380px] rounded-card border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-[15.5px] font-semibold text-text">¿Cómo paga?</h2>

            {renderSelectorPagos(primerMedioRef)}

            {hayDescuento ? (
              <>
                <div className="mb-[5px] flex items-baseline justify-between">
                  <span className="text-[14.5px] font-medium text-text-2">Total en efectivo</span>
                  <span className="text-[22px] font-semibold tabular-nums text-text">
                    {formatoMoneda.format(totalEfectivo)}
                  </span>
                </div>
                <div className="mb-[9px] flex items-baseline justify-between">
                  <span className="text-[14.5px] font-medium text-text-2">Total en otro medio</span>
                  <span className="text-[17px] font-medium tabular-nums text-text-2">
                    {formatoMoneda.format(totalOtroMedio)}
                  </span>
                </div>
              </>
            ) : (
              <div className="mb-[9px] flex items-baseline justify-between">
                <span className="text-[14.5px] font-medium text-text-2">Total</span>
                <span className="text-[24px] font-semibold tabular-nums text-text">
                  {formatoMoneda.format(totalOtroMedio)}
                </span>
              </div>
            )}

            {error && <p className="mb-2 text-[14px] text-err">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMostrarPago(false)}
                className="rounded-[7px] border border-border bg-bg px-[11px] py-[10px] text-[14.5px] font-medium text-text hover:bg-bg-2"
              >
                Seguir escaneando
              </button>
              <button
                type="button"
                disabled={pending || pagos.length === 0 || restante !== 0}
                onClick={confirmar}
                className="flex-1 rounded-[7px] bg-moe px-[11px] py-[10px] text-[15.5px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                {pending
                  ? "Confirmando…"
                  : pagos.length === 0
                    ? "Elegí un medio de pago"
                    : restante !== 0
                      ? "Ajustá los montos"
                      : `Cobrar ${formatoMoneda.format(totalACobrar)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ Modal: editar cantidad (F6) ============ */}
      {editandoCantidadSkuId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setEditandoCantidadSkuId(null)}
        >
          <div className="w-[280px] rounded-card border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-[15.5px] font-semibold text-text">Cantidad</h2>
            <input
              type="number"
              autoFocus
              min={1}
              value={cantidadEditada}
              onChange={(e) => setCantidadEditada(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarEdicionCantidad();
                if (e.key === "Escape") setEditandoCantidadSkuId(null);
              }}
              className={inputClass}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditandoCantidadSkuId(null)}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[14px] font-medium text-text-2 hover:bg-bg-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEdicionCantidad}
                className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[14px] font-medium text-white hover:bg-moe/90"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ Modal: ver precio (F9), sin agregar al ticket ============ */}
      {verPrecioAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => {
            setVerPrecioAbierto(false);
            setVerPrecioQuery("");
          }}
        >
          <div className="w-[400px] rounded-card border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-[15.5px] font-semibold text-text">Ver precio</h2>
            <input
              type="text"
              autoFocus
              value={verPrecioQuery}
              onChange={(e) => setVerPrecioQuery(e.target.value)}
              placeholder="Buscar producto…"
              className={inputClass}
            />
            <div className="mt-2 max-h-[280px] overflow-y-auto">
              {resultadosVerPrecio.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between border-b border-[#F1F1F3] py-[8px] text-[14.5px] last:border-b-0"
                >
                  <span>
                    <span className="font-medium text-text">{s.nombre}</span>
                    <span className="text-text-3">
                      {" "}
                      · {s.marcaNombre} — {presentacionLabel(s.presentacion)}
                    </span>
                  </span>
                  <span className="tabular-nums text-text-2">
                    {s.precioEfectivo != null ? formatoMoneda.format(s.precioEfectivo) : "sin precio"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============ Modal: entrada/salida de efectivo (F7/F8) ============ */}
      {movimientoTipo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setMovimientoTipo(null)}
        >
          <div className="w-[340px] rounded-card border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-[15.5px] font-semibold text-text">
              {movimientoTipo === "entrada" ? "Entrada de efectivo" : "Salida de efectivo"}
            </h2>

            <label className="mb-1 block text-[13.5px] font-medium text-text-2">Monto</label>
            <input
              type="number"
              autoFocus
              min={0}
              value={movimientoMonto}
              onChange={(e) => setMovimientoMonto(e.target.value)}
              className={`${inputClass} mb-3`}
            />

            <label className="mb-1 block text-[13.5px] font-medium text-text-2">Motivo</label>
            <input
              type="text"
              value={movimientoMotivo}
              onChange={(e) => setMovimientoMotivo(e.target.value)}
              placeholder={movimientoTipo === "entrada" ? "Ej. refuerzo de cambio" : "Ej. retiro para depósito"}
              className={inputClass}
            />

            {movimientoError && <p className="mt-2 text-[14px] text-err">{movimientoError}</p>}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMovimientoTipo(null)}
                className="rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[14px] font-medium text-text-2 hover:bg-bg-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={pendingMovimiento}
                onClick={confirmarMovimientoCaja}
                className="rounded-[6px] bg-moe px-[12px] py-[6px] text-[14px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
              >
                {pendingMovimiento ? "Guardando…" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AtajoItem({ label, tecla, deshabilitado }: { label: string; tecla: string; deshabilitado?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${deshabilitado ? "opacity-40" : ""}`}>
      <span className="text-text-2">{label}</span>
      <kbd className="rounded-[4px] border border-border bg-bg-2 px-[6px] py-[1px] text-[12.5px] font-medium text-text-2">
        {tecla}
      </kbd>
    </div>
  );
}
