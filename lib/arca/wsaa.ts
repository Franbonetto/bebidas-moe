// Autenticación WSAA (ex AFIP / ARCA): arma el TRA, lo firma localmente
// como CMS/PKCS#7 con node-forge (la clave privada nunca sale de este
// proceso, CLAUDE.md regla ARCA) y hace loginCms directo contra ARCA.
// El Token+Sign resultante se cachea 12hs en arca_ta_cache (bloque
// arca_leer_ta/arca_guardar_ta de la migración) para no re-firmar en
// cada venta.

import forge from "node-forge";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "@/lib/supabase/server";
import { configArca } from "./env";

// Margen de seguridad: si al TA cacheado le quedan menos de 5 minutos de
// vida, se pide uno nuevo en vez de arriesgarse a que expire a mitad de
// una emisión.
const MARGEN_SEGURIDAD_MS = 5 * 60 * 1000;

type TicketAcceso = { token: string; sign: string };

function buildTRA(servicio: string): string {
  const ahora = Date.now();
  const generationTime = new Date(ahora - 10 * 60 * 1000).toISOString();
  const expirationTime = new Date(ahora + 10 * 60 * 1000).toISOString();
  const uniqueId = Math.floor(ahora / 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

function signTRA(traXml: string): string {
  const { cert, key } = configArca();

  const certificado = forge.pki.certificateFromPem(cert);
  const clavePrivada = forge.pki.privateKeyFromPem(key);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf8");
  p7.addCertificate(certificado);
  p7.addSigner({
    key: clavePrivada,
    certificate: certificado,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // @types/node-forge tipa `value` como string, pero forge espera un
      // Date acá y lo codifica como ASN.1 UTCTime en tiempo de ejecución
      // (comportamiento documentado de la librería, no un bug nuestro).
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

async function loginCms(
  cmsBase64: string,
): Promise<{ token: string; sign: string; expirationTime: string }> {
  const { urls } = configArca();

  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const respuesta = await fetch(urls.wsaa, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: soapEnvelope,
  });

  const textoRespuesta = await respuesta.text();

  if (!respuesta.ok) {
    throw new Error(`WSAA respondió ${respuesta.status}: ${textoRespuesta}`);
  }

  // removeNSPrefix porque ARCA no siempre usa el mismo prefijo de
  // namespace que mandamos nosotros (soapenv: vs soap:, etc).
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const sobre = parser.parse(textoRespuesta);

  const fault = sobre?.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`WSAA rechazó la autenticación: ${fault.faultstring ?? JSON.stringify(fault)}`);
  }

  const loginCmsReturn = sobre?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;
  if (!loginCmsReturn || typeof loginCmsReturn !== "string") {
    throw new Error(`Respuesta de WSAA sin loginCmsReturn: ${textoRespuesta}`);
  }

  const ticket = parser.parse(loginCmsReturn);
  const credentials = ticket?.loginTicketResponse?.credentials;

  if (!credentials?.token || !credentials?.sign) {
    throw new Error(`Respuesta de WSAA sin token/sign: ${loginCmsReturn}`);
  }

  return {
    token: String(credentials.token),
    sign: String(credentials.sign),
    expirationTime: String(ticket.loginTicketResponse.header.expirationTime),
  };
}

// Único punto de entrada que debe usar wsfe.ts: devuelve un TA vigente,
// reusando el cacheado en arca_ta_cache si todavía le queda margen, o
// pidiendo uno nuevo (TRA + firma local + loginCms) si no.
export async function getTA(servicio: string): Promise<TicketAcceso> {
  const supabase = await createClient();

  const { data: cacheRows, error: errorLectura } = await supabase.rpc("arca_leer_ta", {
    p_servicio: servicio,
  });
  if (errorLectura) {
    throw new Error(`No se pudo leer el cache de TA de ARCA: ${errorLectura.message}`);
  }

  const cacheado = Array.isArray(cacheRows) ? cacheRows[0] : undefined;
  if (cacheado && new Date(cacheado.expira_en).getTime() - MARGEN_SEGURIDAD_MS > Date.now()) {
    return { token: cacheado.token, sign: cacheado.sign };
  }

  const tra = buildTRA(servicio);
  const cms = signTRA(tra);
  const { token, sign, expirationTime } = await loginCms(cms);

  const { error: errorGuardado } = await supabase.rpc("arca_guardar_ta", {
    p_servicio: servicio,
    p_token: token,
    p_sign: sign,
    p_expira_en: expirationTime,
  });
  if (errorGuardado) {
    throw new Error(`No se pudo guardar el TA de ARCA en cache: ${errorGuardado.message}`);
  }

  return { token, sign };
}
