"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { presentacionLabel } from "@/app/(app)/productos/_components/productos-table";
import { cargarCompraDirecta } from "../actions";
import { guardarPrecioBase } from "@/app/(app)/precios/actions";
import { actualizarCodigoBarras } from "@/app/(app)/productos/actions";
import { formatoMoneda } from "../_lib/formato";
import {
  TIPOS_COMPROBANTE,
  TIPO_COMPROBANTE_AYUDA,
  TIPO_COMPROBANTE_LABEL,
  desglosarIvaCompra,
  redondearPeso,
  type TipoComprobante,
} from "../_lib/comprobante";
import { SkuPicker, type SkuCatalogo } from "./sku-picker";

type Proveedor = { id: string; razon_social: string; nombre_comercial: string | null };
type CostoReferencia = { proveedor_id: string; sku_id: string; costo_referencia: number | null };

type Linea = {
  sku: SkuCatalogo;
  cantidad: number;
  costoUnitario: number;
  precioVenta: number | null;
  // Opcional: no todos los productos vencen (ej. vinos), otros sí (ej.
  // gaseosa) -- pedido del usuario 2026-09-22.
  fechaVencimiento: string;
  // Familia (x24 -> x6 -> unidad, ver desarma_en_sku_id): al agregar un
  // pack, el resto de su familia aparece acá solo para cargarle el precio
  // de venta ahí mismo -- no entra como línea de compra real (nada de eso
  // se contó físicamente hoy), así que no tiene cantidad ni costo.
  soloPrecio: boolean;
};

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

// El <input type="date"> nativo muestra mm/dd/aaaa o dd/mm/aaaa según el
// idioma configurado en el navegador del que carga, no algo que controlemos
// desde el HTML (el atributo lang no lo cambia) -- para garantizar
// dd/mm/aaaa siempre, sin importar esa configuración, se usa un campo de
// texto con formato controlado (pedido del usuario 2026-09-22).
function formatearFechaVencimiento(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 8);
  const dd = digitos.slice(0, 2);
  const mm = digitos.slice(2, 4);
  const aaaa = digitos.slice(4, 8);
  return [dd, mm, aaaa].filter(Boolean).join("/");
}

function fechaVencimientoValida(valor: string): boolean {
  return valor === "" || /^\d{2}\/\d{2}\/\d{4}$/.test(valor);
}

function fechaVencimientoAIso(valor: string): string | null {
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  return `${aaaa}-${mm}-${dd}`;
}

// Hoy todo el catálogo va al 21% pero el dato vive en la categoría
// (20260907090000_categorias_alicuota_iva.sql) -- mismo fallback que usa la
// facturación de ventas si la categoría no lo trae.
function alicuotaDe(sku: SkuCatalogo): number {
  return sku.producto?.categoria?.alicuota_iva ?? 21;
}

// Tolerancia del cuadre: un peso. Las facturas reales redondean, así que
// exigir el centavo exacto solo generaría una advertencia permanente.
const TOLERANCIA_CUADRE = 1;

export function CompraDirectaForm({
  proveedores,
  skus,
  costosReferencia,
}: {
  proveedores: Proveedor[];
  skus: SkuCatalogo[];
  costosReferencia: CostoReferencia[];
}) {
  const router = useRouter();
  const [proveedorId, setProveedorId] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fechaFactura, setFechaFactura] = useState("");
  // Con qué vino la mercadería. Obligatorio: es lo que después define si esa
  // compra descuenta IVA o no en el balance del dueño.
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobante | "">("");
  // null = todavía no lo tocó, se muestra el número que calcula el sistema a
  // partir de la alícuota de cada categoría. Si escribe, manda lo que escribió
  // (el papel gana sobre el cálculo).
  const [netoInput, setNetoInput] = useState<string | null>(null);
  const [ivaInput, setIvaInput] = useState<string | null>(null);
  const [percepciones, setPercepciones] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [avisoPrecio, setAvisoPrecio] = useState<string | null>(null);
  const [compraCreadaId, setCompraCreadaId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [filaAsignandoCodigo, setFilaAsignandoCodigo] = useState<number | null>(null);
  const [codigoInput, setCodigoInput] = useState("");
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [filaCodigoOk, setFilaCodigoOk] = useState<number | null>(null);

  const excluirIds = useMemo(() => new Set(lineas.map((l) => l.sku.id)), [lineas]);
  const total = lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario, 0);

  // Desglose propuesto: el costo cargado es el precio final pagado (IVA
  // incluido), así que el neto sale para atrás con la alícuota de cada
  // categoría. Es una propuesta -- la encargada lo corrige contra el papel.
  const desgloseSugerido = useMemo(
    () =>
      desglosarIvaCompra(
        lineas
          .filter((l) => !l.soloPrecio)
          .map((l) => ({ total: l.cantidad * l.costoUnitario, alicuotaIva: alicuotaDe(l.sku) })),
      ),
    [lineas],
  );

  const esFactura = tipoComprobante === "factura_a" || tipoComprobante === "factura_b";
  const discriminaIva = tipoComprobante === "factura_a";

  const netoMostrado =
    netoInput ?? (total > 0 ? redondearPeso(desgloseSugerido.neto).toFixed(2) : "");
  const ivaMostrado = ivaInput ?? (total > 0 ? redondearPeso(desgloseSugerido.iva).toFixed(2) : "");
  const netoValor = netoMostrado === "" ? null : Number(netoMostrado);
  const ivaValor = ivaMostrado === "" ? null : Number(ivaMostrado);
  const percepcionesValor = percepciones === "" ? null : Number(percepciones);

  // Se advierte, no se bloquea (mismo criterio que el precio bajo costo):
  // una factura real puede traer bonificaciones o conceptos que no están en
  // las líneas cargadas.
  const cuadre =
    discriminaIva && netoValor !== null && ivaValor !== null
      ? netoValor + ivaValor + (percepcionesValor ?? 0)
      : null;
  const avisoCuadre =
    cuadre !== null && total > 0 && Math.abs(cuadre - total) > TOLERANCIA_CUADRE
      ? `El comprobante suma ${formatoMoneda.format(cuadre)} y lo cargado en las líneas da ${formatoMoneda.format(
          total,
        )}. Revisalo contra la factura — si la diferencia es real (bonificaciones, redondeos), podés registrar igual.`
      : null;

  // Mapa completo de la cadena de desarme (x24 -> x6 -> unidad) para poder
  // encontrar TODA la familia de un SKU sin importar por cuál se entra --
  // hijoId -> padreId es la inversa de desarma_en_sku_id (que va de grande
  // a chico).
  const skuPorId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const padrePorHijoId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const s of skus) {
      if (s.desarma_en_sku_id) mapa.set(s.desarma_en_sku_id, s.id);
    }
    return mapa;
  }, [skus]);

  // Sube hasta el tope de la cadena (el x24) y despues baja recolectando
  // todos los niveles -- así da lo mismo agregar por el x24, el x6 o la
  // unidad, siempre aparece la familia completa.
  function familiaCompleta(skuId: string): SkuCatalogo[] {
    let tope = skuId;
    while (padrePorHijoId.has(tope)) tope = padrePorHijoId.get(tope)!;

    const familia: SkuCatalogo[] = [];
    let actualId: string | null = tope;
    while (actualId) {
      const actual = skuPorId.get(actualId);
      if (!actual) break;
      familia.push(actual);
      actualId = actual.desarma_en_sku_id ?? null;
    }
    return familia;
  }

  function costoSugerido(skuId: string): number {
    if (!proveedorId) return 0;
    const referencia = costosReferencia.find(
      (c) => c.proveedor_id === proveedorId && c.sku_id === skuId,
    );
    return referencia?.costo_referencia ?? 0;
  }

  // Reescanear un código de barras ya cargado suma 1 a esa línea en vez de
  // duplicarla (el picker deja pasar el match aunque esté en excluirIds,
  // justamente para este caso). Si el SKU es parte de una cascada de
  // desarme, el resto de la familia (ej. al cargar el x24, también el x6 y
  // la unidad) aparece junto para poder cargarle el precio de venta ahí
  // mismo, sin tener que buscarlos aparte (pedido del usuario 2026-09-22).
  function agregarLinea(sku: SkuCatalogo) {
    setLineas((prev) => {
      const idx = prev.findIndex((l) => l.sku.id === sku.id);
      let siguiente: Linea[];
      if (idx >= 0) {
        siguiente = [...prev];
        siguiente[idx] = siguiente[idx].soloPrecio
          ? { ...siguiente[idx], soloPrecio: false, cantidad: 1, costoUnitario: costoSugerido(sku.id) }
          : { ...siguiente[idx], cantidad: siguiente[idx].cantidad + 1 };
      } else {
        siguiente = [
          ...prev,
          {
            sku,
            cantidad: 1,
            costoUnitario: costoSugerido(sku.id),
            precioVenta: null,
            fechaVencimiento: "",
            soloPrecio: false,
          },
        ];
      }

      const idsPresentes = new Set(siguiente.map((l) => l.sku.id));
      for (const familiar of familiaCompleta(sku.id)) {
        if (!idsPresentes.has(familiar.id)) {
          siguiente.push({
            sku: familiar,
            cantidad: 0,
            costoUnitario: 0,
            precioVenta: null,
            fechaVencimiento: "",
            soloPrecio: true,
          });
          idsPresentes.add(familiar.id);
        }
      }
      return siguiente;
    });
  }

  function actualizarLinea(
    index: number,
    campo: "cantidad" | "costoUnitario" | "precioVenta",
    valor: number | null,
  ) {
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, [campo]: valor } : l)));
  }

  function actualizarFechaVencimiento(index: number, valor: string) {
    const formateado = formatearFechaVencimiento(valor);
    setLineas((prev) => prev.map((l, i) => (i === index ? { ...l, fechaVencimiento: formateado } : l)));
  }

  function quitarLinea(index: number) {
    setLineas((prev) => prev.filter((_, i) => i !== index));
  }

  function iniciarAsignarCodigo(index: number) {
    setFilaAsignandoCodigo(index);
    setCodigoInput("");
    setErrorCodigo(null);
  }

  function cancelarAsignarCodigo() {
    setFilaAsignandoCodigo(null);
    setCodigoInput("");
    setErrorCodigo(null);
  }

  async function confirmarAsignarCodigo(index: number) {
    const codigo = codigoInput.trim();
    if (!codigo) return;
    const resultado = await actualizarCodigoBarras(lineas[index].sku.id, codigo);
    if ("error" in resultado) {
      setErrorCodigo(resultado.error);
      return;
    }
    setLineas((prev) =>
      prev.map((l, i) => (i === index ? { ...l, sku: { ...l.sku, codigo_barras: codigo } } : l)),
    );
    setFilaAsignandoCodigo(null);
    setCodigoInput("");
    setErrorCodigo(null);
    setFilaCodigoOk(index);
    setTimeout(() => setFilaCodigoOk((cur) => (cur === index ? null : cur)), 2500);
  }

  function validar(): string | null {
    if (!proveedorId) return "Elegí un proveedor.";
    if (!tipoComprobante) return "Indicá con qué vino la mercadería: Factura A, Factura B o remito.";
    if (esFactura && !numeroFactura.trim()) return "Cargá el número de la factura.";
    if (esFactura && !fechaFactura) return "Cargá la fecha de la factura.";
    if (discriminaIva) {
      if (netoValor === null || ivaValor === null)
        return "La Factura A tiene el IVA discriminado: cargá el neto gravado y el IVA.";
      if (!Number.isFinite(netoValor) || netoValor <= 0)
        return "El neto gravado tiene que ser mayor a cero.";
      if (!Number.isFinite(ivaValor) || ivaValor < 0) return "El IVA no puede ser negativo.";
    }
    if (percepcionesValor !== null && (!Number.isFinite(percepcionesValor) || percepcionesValor < 0))
      return "Las percepciones no pueden ser negativas.";

    const lineasReales = lineas.filter((l) => !l.soloPrecio);
    if (lineasReales.length === 0) return "Agregá al menos una línea.";
    for (const l of lineasReales) {
      if (!Number.isInteger(l.cantidad) || l.cantidad <= 0)
        return "La cantidad tiene que ser un entero mayor a cero.";
      if (l.costoUnitario < 0) return "El costo unitario no puede ser negativo.";
    }
    for (const l of lineas) {
      if (l.precioVenta === null)
        return `Cargá el precio de venta de ${l.sku.producto?.nombre ?? l.sku.codigo_interno} — ${presentacionLabel(l.sku)}.`;
      if (l.precioVenta < 0) return "El precio de venta no puede ser negativo.";
      if (!fechaVencimientoValida(l.fechaVencimiento))
        return `La fecha de vencimiento de ${l.sku.producto?.nombre ?? l.sku.codigo_interno} no es válida (dd/mm/aaaa).`;
    }
    return null;
  }

  function registrar() {
    const errorValidacion = validar();
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }
    setError(null);
    setAvisoPrecio(null);
    startTransition(async () => {
      const resultado = await cargarCompraDirecta({
        proveedor_id: proveedorId,
        comprobante: {
          tipo_comprobante: tipoComprobante as TipoComprobante,
          numero_factura: numeroFactura.trim() || null,
          fecha_factura: fechaFactura || null,
          // La B no discrimina IVA y el remito no tiene nada fiscal: se
          // mandan en null a propósito (la base también lo fuerza).
          neto_gravado: discriminaIva ? netoValor : null,
          iva: discriminaIva ? ivaValor : null,
          // El campo solo se muestra con Factura A (es donde aparecen en la
          // práctica): con B o remito no se manda nada.
          percepciones: discriminaIva ? percepcionesValor : null,
        },
        lineas: lineas
          .filter((l) => !l.soloPrecio)
          .map((l) => ({
            sku_id: l.sku.id,
            cantidad: l.cantidad,
            costo_unitario: l.costoUnitario,
            fecha_vencimiento: fechaVencimientoAIso(l.fechaVencimiento),
          })),
      });

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }

      const lineasConPrecio = lineas.filter(
        (l): l is Linea & { precioVenta: number } => l.precioVenta !== null,
      );
      const resultadosPrecio = await Promise.all(
        lineasConPrecio.map((l) => guardarPrecioBase(l.sku.id, l.precioVenta)),
      );
      const fallos = lineasConPrecio
        .map((l, i) => ({ linea: l, resultado: resultadosPrecio[i] }))
        .filter((f) => "error" in f.resultado);

      setLineas([]);
      setNumeroFactura("");
      setFechaFactura("");
      setProveedorId("");
      setTipoComprobante("");
      setNetoInput(null);
      setIvaInput(null);
      setPercepciones("");

      if (fallos.length > 0) {
        setCompraCreadaId(resultado.id);
        setAvisoPrecio(
          `La compra se registró bien, pero no se pudo guardar el precio de: ${fallos
            .map((f) => f.linea.sku.producto?.nombre ?? f.linea.sku.codigo_interno)
            .join(", ")}. Cargalo desde Precios.`,
        );
        return;
      }

      router.push(`/compras/${resultado.id}`);
    });
  }

  return (
    <div className="mx-auto max-w-[880px] rounded-card border border-border bg-bg p-5">
      <h2 className="mb-1 text-[14px] font-semibold text-text">Cargar mercadería</h2>
      <p className="mb-4 text-[12.5px] text-text-3">
        Elegí el proveedor, marcá con qué vino (factura o remito), cargá lo que entró, el costo y el
        precio de venta, y queda todo actualizado (compra, stock, costo y precio) en un solo paso.
        Cada presentación (x24, x6,
        unidad) tiene su propio precio, siempre cargado a mano y obligatorio. Si agregás un pack
        que se desarma, el resto de la familia aparece abajo para cargarle el precio ahí mismo. El
        vencimiento es opcional: cargalo solo si el producto lo tiene.
      </p>

      {avisoPrecio && (
        <div className="mb-4 rounded-[6px] border border-warn/40 bg-warn-bg px-[12px] py-[9px] text-[12.5px] text-warn">
          <p>{avisoPrecio}</p>
          {compraCreadaId && (
            <button
              type="button"
              onClick={() => router.push(`/compras/${compraCreadaId}`)}
              className="mt-1 font-medium underline"
            >
              Ir a la compra
            </button>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <label className={labelClass}>Proveedor *</label>
          <select
            className={inputClass}
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">Elegir…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre_comercial ?? p.razon_social}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>¿Con qué vino la mercadería? *</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TIPOS_COMPROBANTE.map((t) => {
              const activo = tipoComprobante === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipoComprobante(t)}
                  className={`rounded-[6px] border px-[10px] py-[7px] text-left ${
                    activo
                      ? "border-moe bg-moe-soft text-moe"
                      : "border-border bg-bg text-text-2 hover:bg-[#FAFAFB]"
                  }`}
                >
                  <span className="block text-[13px] font-medium">{TIPO_COMPROBANTE_LABEL[t]}</span>
                  <span className="mt-[1px] block text-[11px] leading-[1.3] text-text-3">
                    {TIPO_COMPROBANTE_AYUDA[t]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {esFactura && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Número de factura *</label>
            <input
              className={inputClass}
              value={numeroFactura}
              onChange={(e) => setNumeroFactura(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Fecha de la factura *</label>
            <input
              type="date"
              className={inputClass}
              value={fechaFactura}
              onChange={(e) => setFechaFactura(e.target.value)}
            />
          </div>
        </div>
      )}

      {tipoComprobante === "remito" && (
        <p className="mt-3 rounded-[6px] border border-info/30 bg-info-bg px-[12px] py-[8px] text-[12.5px] text-info">
          Queda registrada como compra sin factura: no descuenta IVA. Cuando llegue la factura,
          entrá a la compra y cargala desde ahí — se actualiza sola en el balance.
        </p>
      )}

      <div className="mt-5">
        <label className={labelClass}>Agregar producto</label>
        <SkuPicker
          skus={skus}
          excluirIds={excluirIds}
          onSelect={agregarLinea}
          onAsignarCodigoBarras={actualizarCodigoBarras}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-[6px] border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border-b border-border bg-bg-2 px-[12px] py-[7px] text-left text-[11.5px] font-medium text-text-2">
                SKU
              </th>
              <th className="w-[100px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Cantidad
              </th>
              <th className="w-[140px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Costo unit.
              </th>
              <th className="w-[140px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Precio de venta
              </th>
              <th className="w-[150px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Vencimiento
              </th>
              <th className="w-[120px] border-b border-border bg-bg-2 px-[12px] py-[7px] text-right text-[11.5px] font-medium text-text-2">
                Subtotal
              </th>
              <th className="w-[40px] border-b border-border bg-bg-2 px-[12px] py-[7px]" />
            </tr>
          </thead>
          <tbody>
            {lineas.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-[12px] py-[16px] text-center text-[12.5px] text-text-3">
                  Todavía no agregaste productos.
                </td>
              </tr>
            ) : (
              lineas.map((l, i) => (
                <tr
                  key={l.sku.id}
                  className={`border-b border-[#F1F1F3] last:border-b-0 ${l.soloPrecio ? "bg-bg-2/40" : ""}`}
                >
                  <td className="px-[12px] py-[7px] align-middle">
                    <p className="font-medium text-text">{l.sku.producto?.nombre}</p>
                    <p className="text-[11.5px] text-text-3">
                      {l.sku.producto?.marca?.nombre} — {presentacionLabel(l.sku)}
                    </p>
                    {!l.sku.codigo_barras &&
                      (filaAsignandoCodigo === i ? (
                        <div className="mt-1 flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={codigoInput}
                            onChange={(e) => setCodigoInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                confirmarAsignarCodigo(i);
                              }
                              if (e.key === "Escape") cancelarAsignarCodigo();
                            }}
                            placeholder="Escaneá el código…"
                            className="w-[150px] rounded-[4px] border border-border bg-bg px-[6px] py-[2px] text-[11.5px] outline-none focus:border-moe"
                          />
                          <button
                            type="button"
                            onClick={cancelarAsignarCodigo}
                            className="text-[11px] text-text-3 hover:text-err"
                          >
                            Cancelar
                          </button>
                          {errorCodigo && <p className="text-[11px] text-err">{errorCodigo}</p>}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => iniciarAsignarCodigo(i)}
                          className="mt-0.5 text-[11px] text-warn underline underline-offset-2"
                        >
                          Sin código de barras · asignar
                        </button>
                      ))}
                    {filaCodigoOk === i && (
                      <p className="mt-0.5 text-[11px] text-ok">Código de barras asignado ✓</p>
                    )}
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    {l.soloPrecio ? (
                      <span className="block text-right text-[12.5px] text-text-3">—</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                        value={l.cantidad}
                        onChange={(e) => actualizarLinea(i, "cantidad", Number(e.target.value))}
                      />
                    )}
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    {l.soloPrecio ? (
                      <span className="block text-right text-[12.5px] text-text-3">—</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                        value={l.costoUnitario}
                        onChange={(e) => actualizarLinea(i, "costoUnitario", Number(e.target.value))}
                      />
                    )}
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Obligatorio"
                      className={`w-full rounded-[6px] border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none placeholder:text-text-3 focus:border-moe ${
                        l.precioVenta === null ? "border-warn/50" : "border-border"
                      }`}
                      value={l.precioVenta ?? ""}
                      onChange={(e) =>
                        actualizarLinea(
                          i,
                          "precioVenta",
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </td>
                  <td className="px-[12px] py-[7px] align-middle">
                    {l.soloPrecio ? (
                      <span className="block text-right text-[12.5px] text-text-3">—</span>
                    ) : (
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="dd/mm/aaaa"
                        title="Opcional — solo si el producto vence"
                        maxLength={10}
                        className="w-full rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[12.5px] tabular-nums outline-none placeholder:text-text-3 focus:border-moe"
                        value={l.fechaVencimiento}
                        onChange={(e) => actualizarFechaVencimiento(i, e.target.value)}
                      />
                    )}
                  </td>
                  <td className="px-[12px] py-[7px] text-right align-middle tabular-nums text-text">
                    {l.soloPrecio ? "—" : formatoMoneda.format(l.cantidad * l.costoUnitario)}
                  </td>
                  <td className="px-[12px] py-[7px] text-right align-middle">
                    <button
                      type="button"
                      onClick={() => quitarLinea(i)}
                      className="text-[12px] text-text-3 hover:text-err"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-end">
        <div className="w-full sm:w-[360px]">
          {discriminaIva && (
            <>
              <p className="mb-[6px] text-[12px] text-text-3">
                Como figura al pie de la factura. Lo calculamos por vos — corregilo si el papel dice
                otra cosa.
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[12.5px] text-text-2">Neto gravado</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-[140px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                    value={netoMostrado}
                    onChange={(e) => setNetoInput(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[12.5px] text-text-2">IVA</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-[140px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none focus:border-moe"
                    value={ivaMostrado}
                    onChange={(e) => setIvaInput(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[12.5px] text-text-2">
                    Percepciones
                    <span className="block text-[11px] text-text-3">IIBB u otras, si tiene</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    className="w-[140px] rounded-[6px] border border-border bg-bg px-[8px] py-[4px] text-right text-[13px] tabular-nums outline-none placeholder:text-text-3 focus:border-moe"
                    value={percepciones}
                    onChange={(e) => setPercepciones(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <p
            className={`text-[13px] font-semibold text-text ${discriminaIva ? "mt-3 border-t border-border pt-2" : ""} text-right`}
          >
            Total: <span className="tabular-nums">{formatoMoneda.format(total)}</span>
          </p>
        </div>
      </div>

      {avisoCuadre && (
        <p className="mt-3 rounded-[6px] border border-warn/40 bg-warn-bg px-[12px] py-[8px] text-[12.5px] text-warn">
          {avisoCuadre}
        </p>
      )}

      {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={registrar}
          disabled={pending}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
        >
          {pending ? "Registrando…" : "Registrar mercadería"}
        </button>
      </div>
    </div>
  );
}
