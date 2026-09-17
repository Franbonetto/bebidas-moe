// WSFEv1 (facturación electrónica): llama directo a los servidores de
// ARCA (nunca a través de un proxy de terceros, CLAUDE.md regla ARCA),
// usando el Token+Sign que entrega getTA() de wsaa.ts.
//
// Este módulo es un wrapper técnico del SOAP de WSFEv1 — no decide
// lógica de negocio (qué alícuota de IVA usar, qué condición de IVA
// corresponde a un receptor, etc). Esas decisiones las toma quien llama
// (el server action de facturación), que todavía no está escrito.

import { XMLParser } from "fast-xml-parser";
import { configArca } from "./env";
import { getTA } from "./wsaa";

type Auth = { token: string; sign: string; cuit: string };

function authXml(auth: Auth): string {
  return `<ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${auth.cuit}</ar:Cuit></ar:Auth>`;
}

async function auth(): Promise<Auth> {
  const { cuit } = configArca();
  const { token, sign } = await getTA("wsfe");
  return { token, sign, cuit };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callWsfe(metodo: string, cuerpoInterno: string): Promise<any> {
  const { urls } = configArca();

  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:${metodo}>
      ${cuerpoInterno}
    </ar:${metodo}>
  </soapenv:Body>
</soapenv:Envelope>`;

  const respuesta = await fetch(urls.wsfe, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `http://ar.gov.afip.dif.FEV1/${metodo}`,
    },
    body: soapEnvelope,
  });

  const texto = await respuesta.text();
  if (!respuesta.ok) {
    throw new Error(`WSFEv1 (${metodo}) respondió ${respuesta.status}: ${texto}`);
  }

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const sobre = parser.parse(texto);

  const fault = sobre?.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`WSFEv1 (${metodo}) rechazó la solicitud: ${fault.faultstring ?? JSON.stringify(fault)}`);
  }

  const resultado = sobre?.Envelope?.Body?.[`${metodo}Response`]?.[`${metodo}Result`];
  if (!resultado) {
    throw new Error(`Respuesta de WSFEv1 (${metodo}) sin resultado: ${texto}`);
  }

  // Errores a nivel request (auth inválida, XML malformado, etc) — no es
  // un rechazo fiscal del comprobante, es que la llamada en sí falló.
  const errores = resultado.Errors?.Err;
  if (errores) {
    const lista = Array.isArray(errores) ? errores : [errores];
    const detalle = lista.map((e) => `${e.Code}: ${e.Msg}`).join(" | ");
    throw new Error(`WSFEv1 (${metodo}) devolvió error: ${detalle}`);
  }

  return resultado;
}

export type CondicionIva = { id: number; nombre: string };

// Sincroniza el catálogo de condiciones de IVA del receptor. Se llama a
// mano desde una pantalla de configuración, no en cada venta (arquitectura.md
// 1.8: "no hardcodear, sincronizar aparte con botón manual").
export async function obtenerCondicionesIva(): Promise<CondicionIva[]> {
  const credenciales = await auth();
  const resultado = await callWsfe("FEParamGetCondicionIvaReceptor", authXml(credenciales));

  const filas = resultado?.ResultGet?.CondicionIvaReceptor;
  const lista = Array.isArray(filas) ? filas : filas ? [filas] : [];

  return lista.map((fila) => ({ id: Number(fila.Id), nombre: String(fila.Desc) }));
}

// Último número autorizado para un punto de venta + tipo de comprobante.
// Hay que llamarlo antes de FECAESolicitar para no duplicar numeración.
export async function obtenerUltimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number> {
  const credenciales = await auth();
  const cuerpo = `${authXml(credenciales)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`;
  const resultado = await callWsfe("FECompUltimoAutorizado", cuerpo);
  return Number(resultado.CbteNro);
}

export type ItemIva = { id: number; baseImponible: number; importe: number };

export type SolicitudCae = {
  ptoVta: number;
  cbteTipo: number; // 1 = Factura A, 6 = Factura B
  docTipo: number; // 80 = CUIT, 99 = Consumidor Final sin identificar
  docNro: string;
  cbteNro: number; // ya calculado como obtenerUltimoAutorizado() + 1
  importeTotal: number;
  importeNeto: number;
  importeIva: number;
  condicionIvaReceptorId: number;
  iva: ItemIva[];
};

export type ResultadoCae =
  | { ok: true; cae: string; vencimientoCae: string }
  | { ok: false; motivo: string };

function formatoFechaArca(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ARCA devuelve fechas como "AAAAMMDD"; comprobantes_fiscales.vencimiento_cae
// es un `date` de Postgres, que espera "AAAA-MM-DD".
function convertirFechaArcaAIso(fechaArca: string): string {
  return `${fechaArca.slice(0, 4)}-${fechaArca.slice(4, 6)}-${fechaArca.slice(6, 8)}`;
}

function formatoImporte(valor: number): string {
  return valor.toFixed(2);
}

export async function solicitarCae(solicitud: SolicitudCae): Promise<ResultadoCae> {
  const credenciales = await auth();
  const hoy = formatoFechaArca(new Date());

  const ivaXml = solicitud.iva
    .map(
      (item) =>
        `<ar:AlicIva><ar:Id>${item.id}</ar:Id><ar:BaseImp>${formatoImporte(item.baseImponible)}</ar:BaseImp><ar:Importe>${formatoImporte(item.importe)}</ar:Importe></ar:AlicIva>`,
    )
    .join("");

  const cuerpo = `${authXml(credenciales)}
<ar:FeCAEReq>
  <ar:FeCabReq>
    <ar:CantReg>1</ar:CantReg>
    <ar:PtoVta>${solicitud.ptoVta}</ar:PtoVta>
    <ar:CbteTipo>${solicitud.cbteTipo}</ar:CbteTipo>
  </ar:FeCabReq>
  <ar:FeDetReq>
    <ar:FECAEDetRequest>
      <ar:Concepto>1</ar:Concepto>
      <ar:DocTipo>${solicitud.docTipo}</ar:DocTipo>
      <ar:DocNro>${solicitud.docNro}</ar:DocNro>
      <ar:CbteDesde>${solicitud.cbteNro}</ar:CbteDesde>
      <ar:CbteHasta>${solicitud.cbteNro}</ar:CbteHasta>
      <ar:CbteFch>${hoy}</ar:CbteFch>
      <ar:ImpTotal>${formatoImporte(solicitud.importeTotal)}</ar:ImpTotal>
      <ar:ImpTotConc>0.00</ar:ImpTotConc>
      <ar:ImpNeto>${formatoImporte(solicitud.importeNeto)}</ar:ImpNeto>
      <ar:ImpOpEx>0.00</ar:ImpOpEx>
      <ar:ImpTrib>0.00</ar:ImpTrib>
      <ar:ImpIVA>${formatoImporte(solicitud.importeIva)}</ar:ImpIVA>
      <ar:MonId>PES</ar:MonId>
      <ar:MonCotiz>1</ar:MonCotiz>
      <ar:CondicionIVAReceptorId>${solicitud.condicionIvaReceptorId}</ar:CondicionIVAReceptorId>
      <ar:Iva>${ivaXml}</ar:Iva>
    </ar:FECAEDetRequest>
  </ar:FeDetReq>
</ar:FeCAEReq>`;

  const resultado = await callWsfe("FECAESolicitar", cuerpo);

  const detalle = resultado?.FeDetResp?.FECAEDetResponse;
  const detalleFinal = Array.isArray(detalle) ? detalle[0] : detalle;

  if (!detalleFinal) {
    throw new Error(`Respuesta de FECAESolicitar sin detalle: ${JSON.stringify(resultado)}`);
  }

  if (detalleFinal.Resultado !== "A") {
    const observaciones = detalleFinal.Observaciones?.Obs;
    const lista = Array.isArray(observaciones) ? observaciones : observaciones ? [observaciones] : [];
    const motivo =
      lista.map((o: { Code: unknown; Msg: unknown }) => `${o.Code}: ${o.Msg}`).join(" | ") ||
      "ARCA rechazó el comprobante sin detalle de motivo";
    return { ok: false, motivo };
  }

  return {
    ok: true,
    cae: String(detalleFinal.CAE),
    vencimientoCae: convertirFechaArcaAIso(String(detalleFinal.CAEFchVto)),
  };
}

export type ComprobanteArca = {
  cae: string;
  vencimientoCae: string;
  importeTotal: number;
  importeNeto: number;
  importeIva: number;
  resultado: string; // "A" aprobado, "R" rechazado
};

// FECompConsultar: consulta un comprobante YA emitido directo contra
// ARCA, para verificar que lo que tenemos guardado localmente coincide
// con lo que ARCA tiene registrado (checklist de testing del bloque —
// no alcanza con que el sistema diga "autorizado", hay que confirmarlo
// contra ARCA).
export async function consultarComprobante(
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number,
): Promise<ComprobanteArca> {
  const credenciales = await auth();
  const cuerpo = `${authXml(credenciales)}
<ar:FeCompConsReq>
  <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
  <ar:CbteNro>${cbteNro}</ar:CbteNro>
  <ar:PtoVta>${ptoVta}</ar:PtoVta>
</ar:FeCompConsReq>`;

  const resultado = await callWsfe("FECompConsultar", cuerpo);
  const datos = resultado?.ResultGet;

  if (!datos) {
    throw new Error(`ARCA no tiene registrado el comprobante ${ptoVta}-${cbteTipo}-${cbteNro}`);
  }

  return {
    cae: String(datos.CodAutorizacion),
    vencimientoCae: convertirFechaArcaAIso(String(datos.FchVto)),
    importeTotal: Number(datos.ImpTotal),
    importeNeto: Number(datos.ImpNeto),
    importeIva: Number(datos.ImpIVA),
    resultado: String(datos.Resultado),
  };
}
