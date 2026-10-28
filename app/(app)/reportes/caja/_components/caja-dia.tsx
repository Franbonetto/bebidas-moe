import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase/traer-todo";
import { formatoFechaHora, formatoHora, formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { presentacionLabel, type SkuPresentacion } from "@/app/(app)/productos/_lib/presentacion";
import {
  BarRow,
  Card,
  EmptyState,
  Kpi,
  KpiGrid,
  SectionHeader,
} from "@/app/(app)/_components/dashboard/ui";
import { Tabla, Td, Th, Tr } from "../../_components/tabla";
import { VentasDia, type VentaDelDia } from "./ventas-dia";

// La caja de UN día, con todo lo que pasó adentro: el arqueo de cada
// sucursal, con qué pagaron, las ventas una por una (desplegables) y el
// resumen de lo que se vendió (pedido del usuario 2026-10-21).
//
// Qué venta es "de ese día": la que colgó de una caja de esa fecha
// (`ventas.caja_id`), no la que cae en un rango de horas. Es la definición
// que usa el negocio -- una venta de las 21:30 pertenece a la caja que se
// abrió esa mañana, aunque en UTC ya sea otro día (ver lib/fecha.ts) -- y
// es también la que usa el cierre de caja para el arqueo.

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  mercado_pago: "Mercado Pago",
  cuenta_dni: "Cuenta DNI",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  qr: "QR",
};

const RESOLUCION_LABEL: Record<string, string> = {
  dinero: "Devolución de dinero",
  cambio: "Cambio por otro producto",
};

type SkuInfo = SkuPresentacion & {
  nombre: string;
  producto: { nombre: string; marca: { nombre: string } | null } | null;
};

type CajaFila = {
  id: string;
  sucursal_id: string;
  estado: "abierta" | "cerrada";
  monto_apertura: number | null;
  efectivo_sistema: number | null;
  efectivo_declarado: number | null;
  diferencia: number | null;
  cantidad_tickets: number | null;
  abierta_en: string;
  cerrada_en: string | null;
  empleado_apertura: { nombre: string } | { nombre: string }[] | null;
  empleado_cierre: { nombre: string } | { nombre: string }[] | null;
};

type VentaFila = {
  id: string;
  sucursal_id: string;
  fecha: string;
  total: number;
  deposito_envases: number;
  es_envio: boolean;
  usuario: { nombre: string } | { nombre: string }[] | null;
};

type ItemFila = {
  venta_id: string;
  sku_id: string | null;
  cantidad: number;
  precio_unitario: number;
  descripcion: string | null;
  promocion_id: string | null;
  sku: SkuInfo | SkuInfo[] | null;
};

type MovimientoFila = {
  caja_id: string;
  tipo: string;
  monto: number;
  motivo: string;
  creado_en: string;
  usuario: { nombre: string } | { nombre: string }[] | null;
};

type DevolucionFila = {
  id: string;
  fecha: string;
  sucursal_id: string;
  resolucion: string;
  medio_reembolso: string | null;
  monto_reembolsado: number | null;
  venta_id: string;
  usuario: { nombre: string } | { nombre: string }[] | null;
};

// Supabase devuelve una relación anidada como objeto o como array según el
// caso; se normaliza acá, mismo criterio que el resto de los reportes.
function unaFila<T>(rel: T | T[] | null): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) ?? null;
}

function nombreRel(rel: { nombre: string } | { nombre: string }[] | null): string | null {
  return unaFila(rel)?.nombre ?? null;
}

export async function CajaDia({
  supabase,
  dia,
  sucursales,
}: {
  supabase: SupabaseClient;
  dia: string;
  sucursales: { id: string; nombre: string }[];
}) {
  const nombreSucursal = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "—";

  const { data: cajasRaw } = await traerTodo(
    supabase
      .from("cajas")
      .select(
        `id, sucursal_id, estado, monto_apertura, efectivo_sistema, efectivo_declarado,
         diferencia, cantidad_tickets, abierta_en, cerrada_en,
         empleado_apertura:empleados!cajas_empleado_apertura_id_fkey ( nombre ),
         empleado_cierre:empleados!cajas_empleado_cierre_id_fkey ( nombre )`,
      )
      .eq("fecha", dia),
  );

  const cajas = (cajasRaw ?? []) as unknown as CajaFila[];
  const idsCajas = cajas.map((c) => c.id);

  if (idsCajas.length === 0) {
    return (
      <Card title="Sin caja ese día">
        <EmptyState
          title="No se abrió ninguna caja"
          sub="Ese día no hubo caja abierta en ninguna de las dos sucursales, así que tampoco hubo ventas: el POS no deja vender con la caja cerrada."
        />
      </Card>
    );
  }

  const { data: ventasRaw } = await traerTodo(
    supabase
      .from("ventas")
      .select(
        "id, sucursal_id, fecha, total, deposito_envases, es_envio, usuario:usuarios ( nombre )",
      )
      .in("caja_id", idsCajas)
      .eq("estado", "confirmada")
      .order("fecha", { ascending: false }),
  );

  const ventas = (ventasRaw ?? []) as unknown as VentaFila[];
  const idsVentas = ventas.map((v) => v.id);

  const [{ data: pagosRaw }, { data: itemsRaw }, { data: movimientosRaw }, { data: devolucionesRaw }] =
    await Promise.all([
      idsVentas.length
        ? traerTodoPorLotes<{ venta_id: string; medio_pago: string; monto: number }>(
            idsVentas,
            (lote) =>
              supabase
                .from("venta_pagos")
                .select("venta_id, medio_pago, monto")
                .in("venta_id", lote),
          )
        : Promise.resolve({ data: [], error: null }),
      // Sin genérico explícito: Supabase tipa las relaciones anidadas como
      // arrays y acá se normalizan con unaFila(), así que el tipo real se
      // fija abajo con el cast (mismo criterio que el resto de los
      // reportes).
      idsVentas.length
        ? traerTodoPorLotes(idsVentas, (lote) =>
            supabase
              .from("venta_items")
              .select(
                `venta_id, sku_id, cantidad, precio_unitario, descripcion, promocion_id,
                 sku:skus ( nombre, tipo_presentacion, volumen, unidad_volumen, unidades_contenidas,
                            producto:productos ( nombre, marca:marcas ( nombre ) ) )`,
              )
              .in("venta_id", lote),
          )
        : Promise.resolve({ data: [], error: null }),
      traerTodo(
        supabase
          .from("movimientos_caja")
          .select("caja_id, tipo, monto, motivo, creado_en, usuario:usuarios ( nombre )")
          .in("caja_id", idsCajas),
      ),
      traerTodo(
        supabase
          .from("devoluciones")
          .select(
            "id, fecha, sucursal_id, resolucion, medio_reembolso, monto_reembolsado, venta_id, usuario:usuarios ( nombre )",
          )
          .in("caja_id", idsCajas),
      ),
    ]);

  // --- Plata del día -------------------------------------------------
  const vendido = ventas.reduce((acc, v) => acc + Number(v.total), 0);
  const ticketPromedio = ventas.length > 0 ? vendido / ventas.length : 0;

  const porMedio = new Map<string, number>();
  for (const p of pagosRaw ?? []) {
    porMedio.set(p.medio_pago, (porMedio.get(p.medio_pago) ?? 0) + Number(p.monto));
  }
  const mediosOrdenados = [...porMedio.entries()].sort((a, b) => b[1] - a[1]);
  const maxMedio = mediosOrdenados[0]?.[1] ?? 0;

  const movimientos = [...((movimientosRaw ?? []) as unknown as MovimientoFila[])].sort((a, b) =>
    a.creado_en < b.creado_en ? 1 : -1,
  );
  const salidas = movimientos
    .filter((m) => m.tipo === "salida")
    .reduce((acc, m) => acc + Number(m.monto), 0);
  const entradas = movimientos
    .filter((m) => m.tipo === "entrada")
    .reduce((acc, m) => acc + Number(m.monto), 0);

  const devoluciones = ((devolucionesRaw ?? []) as unknown as DevolucionFila[]).sort((a, b) =>
    a.fecha < b.fecha ? 1 : -1,
  );
  const devueltoEnEfectivo = devoluciones
    .filter((d) => d.resolucion === "dinero" && d.medio_reembolso === "efectivo")
    .reduce((acc, d) => acc + Number(d.monto_reembolsado ?? 0), 0);

  // La diferencia solo existe en las cajas ya cerradas: una abierta
  // todavía no se contó.
  const cerradas = cajas.filter((c) => c.estado === "cerrada" && c.diferencia != null);
  const diferenciaTotal = cerradas.reduce((acc, c) => acc + Number(c.diferencia), 0);

  // --- Ventas con sus líneas -----------------------------------------
  const items = (itemsRaw ?? []) as unknown as ItemFila[];

  const itemsPorVenta = new Map<string, ItemFila[]>();
  for (const it of items) {
    const lista = itemsPorVenta.get(it.venta_id);
    if (lista) lista.push(it);
    else itemsPorVenta.set(it.venta_id, [it]);
  }

  const mediosPorVenta = new Map<string, string[]>();
  for (const p of pagosRaw ?? []) {
    const lista = mediosPorVenta.get(p.venta_id) ?? [];
    const label = MEDIO_LABEL[p.medio_pago] ?? p.medio_pago;
    if (!lista.includes(label)) lista.push(label);
    mediosPorVenta.set(p.venta_id, lista);
  }

  function nombreItem(it: ItemFila): { nombre: string; detalle: string } {
    const sku = unaFila(it.sku);
    if (!sku) return { nombre: it.descripcion ?? "Sin descripción", detalle: "" };
    return {
      nombre: sku.producto?.nombre ?? sku.nombre,
      detalle: [sku.producto?.marca?.nombre, presentacionLabel(sku)].filter(Boolean).join(" — "),
    };
  }

  const ventasDelDia: VentaDelDia[] = ventas.map((v) => ({
    id: v.id,
    hora: formatoHora.format(new Date(v.fecha)),
    sucursal: nombreSucursal(v.sucursal_id),
    usuario: nombreRel(v.usuario) ?? "—",
    medios: mediosPorVenta.get(v.id)?.join(" + ") ?? "—",
    total: Number(v.total),
    esEnvio: v.es_envio,
    items: (itemsPorVenta.get(v.id) ?? []).map((it) => ({
      ...nombreItem(it),
      cantidad: it.cantidad,
      importe: Number(it.precio_unitario) * it.cantidad,
      promo: it.promocion_id != null,
      particular: it.sku_id == null,
    })),
  }));

  // --- Lo que se vendió ----------------------------------------------
  // Agrupado por SKU; los particulares se agrupan por su descripción, que
  // es lo único que los identifica.
  const porProducto = new Map<
    string,
    { nombre: string; detalle: string; unidades: number; importe: number; particular: boolean }
  >();
  for (const it of items) {
    const clave = it.sku_id ?? `particular:${it.descripcion ?? ""}`;
    const actual = porProducto.get(clave);
    const importe = Number(it.precio_unitario) * it.cantidad;
    if (actual) {
      actual.unidades += it.cantidad;
      actual.importe += importe;
    } else {
      porProducto.set(clave, {
        ...nombreItem(it),
        unidades: it.cantidad,
        importe,
        particular: it.sku_id == null,
      });
    }
  }
  const productos = [...porProducto.values()].sort((a, b) => b.importe - a.importe);
  const unidadesVendidas = productos.reduce((acc, p) => acc + p.unidades, 0);
  const importeProductos = productos.reduce((acc, p) => acc + p.importe, 0);
  const depositoEnvases = ventas.reduce((acc, v) => acc + Number(v.deposito_envases), 0);

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <Kpi
          label="Vendido"
          value={formatoMoneda.format(vendido)}
          sub={`${ventas.length} ticket${ventas.length === 1 ? "" : "s"} · promedio ${formatoMoneda.format(ticketPromedio)}`}
        />
        <Kpi label="Unidades vendidas" value={unidadesVendidas} sub={`${productos.length} producto${productos.length === 1 ? "" : "s"} distinto${productos.length === 1 ? "" : "s"}`} />
        <Kpi
          label="Diferencia de caja"
          value={cerradas.length === 0 ? "—" : formatoMoneda.format(diferenciaTotal)}
          sub={
            cerradas.length === 0
              ? "Ninguna caja cerrada todavía"
              : `${cerradas.length} de ${cajas.length} caja${cajas.length === 1 ? "" : "s"} cerrada${cerradas.length === 1 ? "" : "s"}`
          }
        />
        <Kpi
          label="Salidas del cajón"
          value={formatoMoneda.format(salidas)}
          sub={entradas > 0 ? `${formatoMoneda.format(entradas)} de entradas` : "Sin entradas"}
        />
      </KpiGrid>

      <div>
        <SectionHeader title="Arqueo" meta="Quién abrió, quién cerró y cuánto faltó o sobró" />
        <Card title={`${cajas.length} caja${cajas.length === 1 ? "" : "s"} ese día`}>
          <Tabla>
            <thead>
              <tr>
                <Th>Sucursal</Th>
                <Th>Abrió</Th>
                <Th>Cerró</Th>
                <Th align="right">Apertura</Th>
                <Th align="right">Según sistema</Th>
                <Th align="right">Contado</Th>
                <Th align="right">Diferencia</Th>
                <Th align="right">Tickets</Th>
              </tr>
            </thead>
            <tbody>
              {cajas.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <span className="font-medium text-text">{nombreSucursal(c.sucursal_id)}</span>
                  </Td>
                  <Td>
                    {nombreRel(c.empleado_apertura) ?? "—"}
                    <span className="text-text-3"> · {formatoHora.format(new Date(c.abierta_en))}</span>
                  </Td>
                  <Td>
                    {c.estado === "abierta" ? (
                      <span className="rounded-[5px] bg-ok-bg px-[7px] py-[2px] text-[11px] font-medium text-ok">
                        Abierta
                      </span>
                    ) : (
                      <>
                        {nombreRel(c.empleado_cierre) ?? "—"}
                        {c.cerrada_en && (
                          <span className="text-text-3">
                            {" "}
                            · {formatoHora.format(new Date(c.cerrada_en))}
                          </span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td align="right" numero>
                    {formatoMoneda.format(c.monto_apertura ?? 0)}
                  </Td>
                  <Td align="right" numero mute={c.efectivo_sistema == null}>
                    {c.efectivo_sistema == null ? "—" : formatoMoneda.format(c.efectivo_sistema)}
                  </Td>
                  <Td align="right" numero mute={c.efectivo_declarado == null}>
                    {c.efectivo_declarado == null ? "—" : formatoMoneda.format(c.efectivo_declarado)}
                  </Td>
                  <Td align="right" numero>
                    {c.diferencia == null ? (
                      <span className="text-text-3">—</span>
                    ) : (
                      <span
                        className={
                          c.diferencia === 0 ? "text-ok" : c.diferencia < 0 ? "text-err" : "text-warn"
                        }
                      >
                        {formatoMoneda.format(c.diferencia)}
                      </span>
                    )}
                  </Td>
                  <Td align="right" numero>
                    {c.cantidad_tickets ?? "—"}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
          {devueltoEnEfectivo > 0 && (
            <p className="border-t border-border px-[14px] py-[9px] text-[11.5px] text-text-3">
              El efectivo esperado ya tiene descontados {formatoMoneda.format(devueltoEnEfectivo)}{" "}
              de devoluciones pagadas del cajón.
            </p>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader title="Con qué pagaron" meta="Sale de cada pago, no del medio de la venta: un pago dividido suma en los dos" />
        <Card title="Medios de pago">
          {mediosOrdenados.length === 0 ? (
            <EmptyState title="Sin cobros" sub="No hubo ventas confirmadas en ese día." />
          ) : (
            <div className="flex flex-col gap-[9px] px-[14px] py-[13px]">
              {mediosOrdenados.map(([medio, monto]) => (
                <BarRow
                  key={medio}
                  label={MEDIO_LABEL[medio] ?? medio}
                  value={monto}
                  max={maxMedio}
                  display={formatoMoneda.format(monto)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader title="Ventas del día" meta="Tocá una venta para ver qué se llevó" />
        <Card title={`${ventas.length} venta${ventas.length === 1 ? "" : "s"} · ${formatoMoneda.format(vendido)}`}>
          {ventas.length === 0 ? (
            <EmptyState
              title="Sin ventas"
              sub="La caja se abrió pero no se cobró ninguna venta en el día."
            />
          ) : (
            <VentasDia ventas={ventasDelDia} />
          )}
        </Card>
      </div>

      <div>
        <SectionHeader
          title="Lo que se vendió"
          meta="Cada producto con lo que se cobró por él, promociones y descuento de efectivo ya aplicados"
        />
        <Card
          title={`${unidadesVendidas} unidad${unidadesVendidas === 1 ? "" : "es"} · ${formatoMoneda.format(importeProductos)}`}
        >
          {productos.length === 0 ? (
            <EmptyState title="Sin productos" sub="No se vendió nada en el día." />
          ) : (
            <>
              <Tabla>
                <thead>
                  <tr>
                    <Th>Producto</Th>
                    <Th align="right">Unidades</Th>
                    <Th align="right">Importe</Th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p, i) => (
                    <Tr key={`${p.nombre}:${i}`}>
                      <Td>
                        <span className="font-medium text-text">{p.nombre}</span>
                        {p.detalle && <span className="text-text-3"> · {p.detalle}</span>}
                        {p.particular && (
                          <span className="ml-[6px] rounded-[5px] bg-bg-2 px-[6px] py-[1px] text-[11px] font-medium text-text-2">
                            Particular
                          </span>
                        )}
                      </Td>
                      <Td align="right" numero>
                        {p.unidades}
                      </Td>
                      <Td align="right" numero>
                        {formatoMoneda.format(p.importe)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Tabla>
              {depositoEnvases > 0 && (
                <p className="border-t border-border px-[14px] py-[9px] text-[11.5px] text-text-3">
                  Además se cobraron {formatoMoneda.format(depositoEnvases)} de depósito de envases,
                  que no son venta de mercadería: por eso este total y el del día difieren en ese
                  monto.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {movimientos.length > 0 && (
        <div>
          <SectionHeader
            title="Entradas y salidas del cajón"
            meta="Con el motivo que escribió quien lo hizo"
          />
          <Card
            title={`Salidas ${formatoMoneda.format(salidas)} · entradas ${formatoMoneda.format(entradas)}`}
          >
            <Tabla>
              <thead>
                <tr>
                  <Th>Hora</Th>
                  <Th>Sucursal</Th>
                  <Th>Tipo</Th>
                  <Th>Motivo</Th>
                  <Th>Quién</Th>
                  <Th align="right">Monto</Th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m, i) => {
                  const caja = cajas.find((c) => c.id === m.caja_id);
                  return (
                    <Tr key={`${m.caja_id}:${m.creado_en}:${i}`}>
                      <Td>{formatoHora.format(new Date(m.creado_en))}</Td>
                      <Td>{caja ? nombreSucursal(caja.sucursal_id) : "—"}</Td>
                      <Td>
                        {m.tipo === "entrada" ? (
                          <span className="rounded-[5px] bg-ok-bg px-[7px] py-[2px] text-[11px] font-medium text-ok">
                            Entrada
                          </span>
                        ) : (
                          <span className="rounded-[5px] bg-err-bg px-[7px] py-[2px] text-[11px] font-medium text-err">
                            Salida
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-text">{m.motivo}</span>
                      </Td>
                      <Td>{nombreRel(m.usuario) ?? "—"}</Td>
                      <Td align="right" numero>
                        <span className={m.tipo === "entrada" ? "text-ok" : "text-err"}>
                          {m.tipo === "entrada" ? "+" : "−"}
                          {formatoMoneda.format(Number(m.monto))}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Tabla>
          </Card>
        </div>
      )}

      {devoluciones.length > 0 && (
        <div>
          <SectionHeader
            title="Devoluciones"
            meta="Solo la devuelta en efectivo descuenta del arqueo del día"
          />
          <Card title={`${devoluciones.length} devolución${devoluciones.length === 1 ? "" : "es"}`}>
            <Tabla>
              <thead>
                <tr>
                  <Th>Hora</Th>
                  <Th>Sucursal</Th>
                  <Th>Resolución</Th>
                  <Th>Se devolvió con</Th>
                  <Th>Quién</Th>
                  <Th align="right">Reembolsado</Th>
                </tr>
              </thead>
              <tbody>
                {devoluciones.map((d) => (
                  <Tr key={d.id}>
                    <Td>{formatoFechaHora.format(new Date(d.fecha))}</Td>
                    <Td>{nombreSucursal(d.sucursal_id)}</Td>
                    <Td>
                      <span className="text-text">
                        {RESOLUCION_LABEL[d.resolucion] ?? d.resolucion}
                      </span>
                    </Td>
                    <Td>
                      {d.medio_reembolso == null ? (
                        <span className="text-text-3">—</span>
                      ) : (
                        <>
                          {MEDIO_LABEL[d.medio_reembolso] ?? d.medio_reembolso}
                          {d.medio_reembolso !== "efectivo" && (
                            <span className="text-text-3"> · no sale del cajón</span>
                          )}
                        </>
                      )}
                    </Td>
                    <Td>{nombreRel(d.usuario) ?? "—"}</Td>
                    <Td align="right" numero mute={d.monto_reembolsado == null}>
                      {d.monto_reembolsado == null
                        ? "sin dinero"
                        : `−${formatoMoneda.format(d.monto_reembolsado)}`}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Tabla>
          </Card>
        </div>
      )}
    </div>
  );
}
