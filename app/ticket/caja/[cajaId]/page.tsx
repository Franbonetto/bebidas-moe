import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase/traer-todo";
import { operaSucursal } from "@/lib/permisos";
import { formatoMoneda } from "@/app/(app)/vender/_lib/formato";
import { formatoFecha, formatoFechaHora, formatoHora } from "@/app/(app)/compras/_lib/formato";
import { fechaOperativa } from "@/lib/fecha";
import { linkWhatsapp, telefonoWhatsapp } from "@/lib/whatsapp";
import { EnviarCierreWhatsapp } from "../../_components/enviar-cierre-whatsapp";
import { ImprimirBoton } from "../../_components/imprimir-boton";
import { ImprimirAlAbrir } from "../../_components/imprimir-al-abrir";

// Ticket de cierre de caja (pedido del usuario 2026-10-19: "al cerrar caja
// que imprima ticket con fecha, hora, nombre de quien cerró y todos los
// datos"). Se imprime en la misma térmica que el ticket de venta, así que
// comparte las clases de impresión (ver app/globals.css, .ticket-print).
//
// Los números NO son un cálculo nuevo: son los mismos que muestra
// /vender/caja, sacados de donde manda cada uno -- el desglose por medio
// sale de venta_pagos (una venta con pago dividido aporta a cada medio su
// parte), no de ventas.medio_pago.
//
// El efectivo del sistema, el declarado y la diferencia salen de las
// columnas que fijó cerrar_caja() al cerrar: son el snapshot inmutable de
// ese momento, no se recalculan acá.
//
// Lo único que el cierre hace con esos números es restarles el monto de
// apertura (pedido del usuario 2026-10-22): esa plata no sale del local,
// queda en el cajón para abrir mañana, así que el papel y el mensaje
// informan el efectivo del día sin ella. El monto sale de
// cajas.monto_apertura, el que la encargada contó al abrir -- no hay
// ningún importe escrito en el código. La diferencia no cambia: restarle
// lo mismo al sistema y al contado la deja igual.

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  mercado_pago: "Mercado Pago",
  cuenta_dni: "Cuenta DNI",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  qr: "QR",
};

// El cierre como texto para mandárselo al dueño por WhatsApp (pedido del
// usuario 2026-10-19). Los asteriscos son el negrita de WhatsApp. Es el
// mismo contenido que el ticket de papel y en el mismo orden, para que el
// dueño lea lo mismo que tiene la encargada en la mano.
function mensajeCierre(datos: {
  sucursal: string;
  // Primer nombre del dueño, para que el mensaje llegue como lo mandaría
  // una persona y no como una notificación. null si no se pudo leer.
  nombreDueno: string | null;
  fecha: string;
  abrio: string;
  cerro: string;
  tickets: number;
  ventasTotal: number;
  porMedio: [string, number][];
  envios: { cantidad: number; total: number };
  devolucionesEfectivo: number;
  entradas: number;
  salidas: number;
  apertura: number;
  sistema: number;
  contado: number;
  diferencia: number;
}): string {
  const plata = (n: number) => formatoMoneda.format(n);
  // El efectivo que se informa es el del día: el de apertura queda en el
  // cajón. Se le resta a los dos lados del arqueo, así la diferencia
  // sigue siendo la misma que fijó cerrar_caja().
  const sistemaNeto = datos.sistema - datos.apertura;
  const contadoNeto = datos.contado - datos.apertura;
  // La sucursal va en mayúscula y en negrita: es lo primero que el dueño
  // necesita distinguir cuando le entran los dos cierres la misma noche
  // (pedido del usuario 2026-10-19).
  const lineas: string[] = [
    `Hola${datos.nombreDueno ? ` ${datos.nombreDueno}` : ""}, este es el cierre de caja de ` +
      `*${datos.sucursal.toLocaleUpperCase("es-AR")}*`,
    datos.fecha,
    "",
    `Abrió: ${datos.abrio}`,
    `Cerró: ${datos.cerro}`,
    "",
    `*Ventas: ${plata(datos.ventasTotal)}* — ${datos.tickets} ticket${datos.tickets === 1 ? "" : "s"}`,
  ];

  for (const [medio, monto] of datos.porMedio) {
    if (monto > 0) lineas.push(`  ${MEDIO_LABEL[medio] ?? medio}: ${plata(monto)}`);
  }

  if (datos.envios.cantidad > 0) {
    lineas.push(
      `  (de eso, ${datos.envios.cantidad} envío${datos.envios.cantidad === 1 ? "" : "s"} por ${plata(datos.envios.total)})`,
    );
  }

  lineas.push("");
  lineas.push(
    `Apertura: ${plata(datos.apertura)}` + (datos.apertura > 0 ? " (queda en el cajón)" : ""),
  );
  if (datos.entradas > 0) lineas.push(`Entradas de caja: +${plata(datos.entradas)}`);
  if (datos.salidas > 0) lineas.push(`Salidas de caja: −${plata(datos.salidas)}`);
  if (datos.devolucionesEfectivo > 0) {
    lineas.push(`Devoluciones en efectivo: −${plata(datos.devolucionesEfectivo)}`);
  }

  lineas.push("");
  lineas.push(`Efectivo del día según sistema: ${plata(sistemaNeto)}`);
  lineas.push(`Efectivo del día contado: ${plata(contadoNeto)}`);
  lineas.push(
    `*Diferencia: ${plata(datos.diferencia)}*` +
      (datos.diferencia === 0
        ? " — cerró justa"
        : datos.diferencia > 0
          ? " — sobra plata en el cajón"
          : " — falta plata en el cajón"),
  );

  return lineas.join("\n");
}

type CajaFila = {
  id: string;
  sucursal_id: string;
  fecha: string;
  estado: string;
  monto_apertura: number | null;
  efectivo_sistema: number | null;
  efectivo_declarado: number | null;
  diferencia: number | null;
  cantidad_tickets: number | null;
  abierta_en: string;
  cerrada_en: string | null;
  sucursal: { nombre: string; direccion: string | null } | null;
  empleado_apertura: { nombre: string } | null;
  empleado_cierre: { nombre: string } | null;
};

export default async function TicketCajaPage({
  params,
  searchParams,
}: {
  params: Promise<{ cajaId: string }>;
  searchParams: Promise<{ imprimir?: string }>;
}) {
  const { cajaId } = await params;
  const { imprimir } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: cajaRaw } = await supabase
    .from("cajas")
    .select(
      `id, sucursal_id, fecha, estado, monto_apertura, efectivo_sistema, efectivo_declarado,
       diferencia, cantidad_tickets, abierta_en, cerrada_en,
       sucursal:sucursales ( nombre, direccion ),
       empleado_apertura:empleados!cajas_empleado_apertura_id_fkey ( nombre ),
       empleado_cierre:empleados!cajas_empleado_cierre_id_fkey ( nombre )`,
    )
    .eq("id", cajaId)
    .maybeSingle();

  const caja = cajaRaw as unknown as CajaFila | null;
  if (!caja) notFound();

  const puedeVer = await operaSucursal(supabase, caja.sucursal_id);
  if (!puedeVer) {
    return <div className="p-6 text-[13px] text-text-2">No tenés permiso para ver esta caja.</div>;
  }

  const { data: ventasRaw } = await traerTodo(
    supabase
      .from("ventas")
      .select("id, total, es_envio")
      .eq("caja_id", caja.id)
      .eq("estado", "confirmada"),
  );

  const ventas = (ventasRaw ?? []) as { id: string; total: number; es_envio: boolean }[];
  const idsVentas = ventas.map((v) => v.id);

  const [{ data: pagosRaw }, { data: movimientosRaw }, { data: devolucionesRaw }] = await Promise.all([
    idsVentas.length > 0
      ? traerTodoPorLotes(idsVentas, (lote) =>
          supabase.from("venta_pagos").select("medio_pago, monto").in("venta_id", lote),
        )
      : Promise.resolve({ data: [], error: null }),
    traerTodo(supabase.from("movimientos_caja").select("tipo, monto, motivo").eq("caja_id", caja.id)),
    traerTodo(
      supabase
        .from("devoluciones")
        .select("monto_reembolsado")
        .eq("caja_id", caja.id)
        .eq("resolucion", "dinero")
        // Solo el efectivo sale del cajon (ver cerrar_caja en
        // 20261019110000_devolucion_medio_reembolso.sql).
        .eq("medio_reembolso", "efectivo"),
    ),
  ]);

  const totalPorMedio = new Map<string, number>();
  let totalGeneral = 0;
  for (const p of (pagosRaw ?? []) as { medio_pago: string; monto: number }[]) {
    totalPorMedio.set(p.medio_pago, (totalPorMedio.get(p.medio_pago) ?? 0) + p.monto);
    totalGeneral += p.monto;
  }

  const movimientos = (movimientosRaw ?? []) as { tipo: string; monto: number; motivo: string | null }[];
  const entradas = movimientos.filter((m) => m.tipo === "entrada");
  const salidas = movimientos.filter((m) => m.tipo === "salida");
  const entradasTotal = entradas.reduce((acc, m) => acc + m.monto, 0);
  const salidasTotal = salidas.reduce((acc, m) => acc + m.monto, 0);

  const devolucionesTotal = ((devolucionesRaw ?? []) as { monto_reembolsado: number | null }[]).reduce(
    (acc, d) => acc + (d.monto_reembolsado ?? 0),
    0,
  );

  // A quién va dirigido el mensaje de WhatsApp. Sale de `usuarios`, igual
  // que el saludo del inicio: no está escrito en el código. Cualquier
  // usuario activo puede leer la tabla (política usuarios_select), así que
  // la cajera que cierra la caja lo ve.
  const { data: duenoRaw } = await supabase
    .from("usuarios")
    .select("nombre")
    .eq("rol", "dueno")
    .limit(1)
    .maybeSingle();
  const nombreDueno = (duenoRaw?.nombre ?? "").trim().split(/\s+/)[0] || null;

  const envios = ventas.filter((v) => v.es_envio);
  const enviosTotal = envios.reduce((acc, v) => acc + v.total, 0);

  const cerrada = caja.estado === "cerrada";
  const diferencia = caja.diferencia ?? 0;

  // El efectivo del día, sin la apertura: ver la nota de arriba.
  const apertura = caja.monto_apertura ?? 0;
  const sistemaNeto = (caja.efectivo_sistema ?? 0) - apertura;
  const contadoNeto = (caja.efectivo_declarado ?? 0) - apertura;

  // El número del dueño vive en WHATSAPP_DUENO (Vercel y .env.local), no en
  // el repo. Si falta, no hay botón.
  const telefonoDueno = telefonoWhatsapp(process.env.WHATSAPP_DUENO);
  // El cierre del dia es el que hay que mandar si o si; un cierre viejo que
  // se vuelve a abrir para reimprimir no tiene por que gritar "falta
  // mandarlo".
  const esCierreDeHoy = cerrada && caja.fecha === fechaOperativa();
  const linkCierre =
    cerrada && telefonoDueno
      ? linkWhatsapp(
          telefonoDueno,
          mensajeCierre({
            sucursal: caja.sucursal?.nombre ?? "",
            nombreDueno: nombreDueno,
            fecha: formatoFecha.format(new Date(caja.fecha + "T12:00:00")),
            abrio: `${caja.empleado_apertura?.nombre ?? "—"} (${formatoHora.format(new Date(caja.abierta_en))})`,
            cerro: `${caja.empleado_cierre?.nombre ?? "—"}${caja.cerrada_en ? ` (${formatoHora.format(new Date(caja.cerrada_en))})` : ""}`,
            tickets: caja.cantidad_tickets ?? ventas.length,
            ventasTotal: totalGeneral,
            porMedio: [...totalPorMedio.entries()],
            envios: { cantidad: envios.length, total: enviosTotal },
            devolucionesEfectivo: devolucionesTotal,
            entradas: entradasTotal,
            salidas: salidasTotal,
            apertura: caja.monto_apertura ?? 0,
            sistema: caja.efectivo_sistema ?? 0,
            contado: caja.efectivo_declarado ?? 0,
            diferencia,
          }),
        )
      : null;

  return (
    <div className="ticket-print mx-auto max-w-[380px] p-4 text-[13px] text-text">
      {imprimir === "1" && <ImprimirAlAbrir />}

      {/* El cierre no termina en el papel: el dueño lo tiene que recibir.
          En el cierre de hoy es un pendiente en rojo arriba de todo; en uno
          viejo, un botón más. */}
      {esCierreDeHoy && <EnviarCierreWhatsapp link={linkCierre} nombreDueno={nombreDueno} />}

      <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
        {linkCierre && !esCierreDeHoy && (
          <a
            href={linkCierre}
            target="_blank"
            rel="noreferrer"
            className="rounded-[7px] border border-border bg-bg px-[16px] py-[9px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
          >
            Enviar al dueño por WhatsApp
          </a>
        )}
        <ImprimirBoton />
      </div>

      <div className="text-center">
        <p className="tk-nombre text-[15px] font-bold">Bebidas Moe</p>
        {caja.sucursal?.direccion && (
          <p className="tk-chico text-[12px] text-text-3">{caja.sucursal.direccion}</p>
        )}
        <p className="tk-chico text-[12px] text-text-3">{caja.sucursal?.nombre}</p>
      </div>

      <div className="my-3 border-t border-dashed border-border" />

      <div className="text-center">
        <p className="text-[13px] font-bold uppercase tracking-wide">
          {cerrada ? "Cierre de caja" : "Caja del día (abierta)"}
        </p>
        <p className="tk-chico text-[12px]">{formatoFecha.format(new Date(caja.fecha + "T12:00:00"))}</p>
      </div>

      <div className="my-3 border-t border-dashed border-border" />

      {/* Quién y cuándo: lo primero que se mira cuando un cierre no cuadra. */}
      <div className="flex flex-col gap-[3px]">
        <div className="flex justify-between gap-2">
          <span className="text-text-2">Abrió</span>
          <span className="tk-desc text-right font-medium">
            {caja.empleado_apertura?.nombre ?? "—"} · {formatoHora.format(new Date(caja.abierta_en))}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-text-2">Cerró</span>
          <span className="tk-desc text-right font-medium">
            {caja.empleado_cierre?.nombre ?? "—"}
            {caja.cerrada_en ? ` · ${formatoHora.format(new Date(caja.cerrada_en))}` : ""}
          </span>
        </div>
        {caja.cerrada_en && (
          <div className="flex justify-between gap-2">
            <span className="text-text-2">Fecha y hora del cierre</span>
            <span className="tk-chico text-right">
              {formatoFechaHora.format(new Date(caja.cerrada_en))}
            </span>
          </div>
        )}
      </div>

      <div className="my-3 border-t border-dashed border-border" />

      <div className="flex flex-col gap-[3px]">
        <div className="flex justify-between">
          <span>Monto de apertura</span>
          <span className="tabular-nums">{formatoMoneda.format(apertura)}</span>
        </div>
        {apertura > 0 && (
          <p className="tk-chico text-[11.5px] text-text-2">
            Queda en el cajón para abrir mañana: no entra en el efectivo del día.
          </p>
        )}
      </div>

      <div className="my-3 border-t border-dashed border-border" />

      {/* Ventas por medio de pago */}
      <div className="flex flex-col gap-[3px]">
        {Object.entries(MEDIO_LABEL).map(([id, label]) => (
          <div key={id} className="flex justify-between">
            <span className="text-text-2">{label}</span>
            <span className="tabular-nums">{formatoMoneda.format(totalPorMedio.get(id) ?? 0)}</span>
          </div>
        ))}
        <div className="tk-total flex justify-between text-[15px] font-bold">
          <span>Total vendido</span>
          <span className="tabular-nums">{formatoMoneda.format(totalGeneral)}</span>
        </div>
        <div className="flex justify-between">
          <span className="tk-chico text-text-2">Tickets</span>
          <span className="tk-chico tabular-nums">{caja.cantidad_tickets ?? ventas.length}</span>
        </div>
        {envios.length > 0 && (
          <div className="flex justify-between">
            <span className="tk-chico text-text-2">
              De arriba, {envios.length} envío{envios.length === 1 ? "" : "s"}
            </span>
            <span className="tk-chico tabular-nums">{formatoMoneda.format(enviosTotal)}</span>
          </div>
        )}
      </div>

      {(devolucionesTotal > 0 || movimientos.length > 0) && (
        <>
          <div className="my-3 border-t border-dashed border-border" />
          <div className="flex flex-col gap-[3px]">
            {devolucionesTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-text-2">Devoluciones en efectivo</span>
                <span className="tabular-nums">−{formatoMoneda.format(devolucionesTotal)}</span>
              </div>
            )}

            {/* Cada entrada y salida con su motivo: es la única forma de
                explicar después por qué el efectivo no es el de las
                ventas. */}
            {entradas.map((m, i) => (
              <div key={`e${i}`} className="flex justify-between gap-2">
                <span className="tk-desc text-text-2">Entrada · {m.motivo ?? "sin motivo"}</span>
                <span className="shrink-0 tabular-nums">+{formatoMoneda.format(m.monto)}</span>
              </div>
            ))}
            {salidas.map((m, i) => (
              <div key={`s${i}`} className="flex justify-between gap-2">
                <span className="tk-desc text-text-2">Egreso · {m.motivo ?? "sin motivo"}</span>
                <span className="shrink-0 tabular-nums">−{formatoMoneda.format(m.monto)}</span>
              </div>
            ))}

            {(entradasTotal > 0 || salidasTotal > 0) && (
              <div className="flex justify-between font-medium">
                <span>Neto de entradas y egresos</span>
                <span className="tabular-nums">
                  {formatoMoneda.format(entradasTotal - salidasTotal)}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <div className="my-3 border-t border-dashed border-border" />

      {cerrada ? (
        <div className="flex flex-col gap-[3px]">
          <div className="flex justify-between">
            <span className="text-text-2">Efectivo del día según sistema</span>
            <span className="tabular-nums">{formatoMoneda.format(sistemaNeto)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-2">Efectivo del día contado</span>
            <span className="tabular-nums">{formatoMoneda.format(contadoNeto)}</span>
          </div>
          <div className="tk-total flex justify-between text-[15px] font-bold">
            <span>Diferencia</span>
            <span className="tabular-nums">{formatoMoneda.format(diferencia)}</span>
          </div>
          {apertura > 0 && (
            <p className="tk-chico text-center text-[11.5px] text-text-2">
              Los dos importes son sin los {formatoMoneda.format(apertura)} de apertura.
            </p>
          )}
          <p className="tk-chico text-center text-[11.5px] text-text-2">
            {diferencia === 0
              ? "La caja cerró justa."
              : diferencia > 0
                ? "Sobra plata en el cajón."
                : "Falta plata en el cajón."}
          </p>
        </div>
      ) : (
        <p className="tk-chico text-center text-[11.5px] font-medium text-text-2">
          La caja todavía no se cerró: el efectivo contado y la diferencia salen recién al cerrarla.
        </p>
      )}

      <div className="my-3 border-t border-dashed border-border" />

      <div className="flex flex-col items-center gap-[6px]">
        <p className="tk-chico text-center text-[11.5px] text-text-2">
          Documento interno de control — no válido como factura
        </p>
        {/* Para firmar al pie: el cierre se archiva en papel. */}
        <div className="w-[70%] border-t border-text-3 pt-[3px] text-center">
          <span className="tk-chico text-[11px] text-text-3">Firma</span>
        </div>
      </div>
    </div>
  );
}
