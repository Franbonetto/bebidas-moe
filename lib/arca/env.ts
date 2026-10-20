// Configuración de entorno para la integración ARCA (WSAA/WSFEv1).
// Cert, key y CUIT viven solo en variables de entorno del servidor —
// nunca en el repo, nunca en el cliente (CLAUDE.md, regla ARCA).

export type EntornoArca = "homologacion" | "produccion";

const URLS: Record<EntornoArca, { wsaa: string; wsfe: string }> = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

export function configArca(): {
  entorno: EntornoArca;
  cert: string;
  key: string;
  cuit: string;
  urls: { wsaa: string; wsfe: string };
} {
  // El `as EntornoArca` es necesario: process.env es `string | undefined`
  // y TypeScript no angosta un `string` por descartarle literales, así
  // que sin esto el entorno sale tipado como `string` y se pierde en
  // cuanto alguien lo usa (ej. el cartel de ambiente de
  // /vender/facturar/configuracion). El chequeo de abajo es la garantía
  // real de que el valor es uno de los dos.
  const entorno = process.env.ARCA_ENTORNO as EntornoArca | undefined;
  if (entorno !== "homologacion" && entorno !== "produccion") {
    throw new Error("ARCA_ENTORNO debe ser 'homologacion' o 'produccion'");
  }

  const cert = process.env.ARCA_CERT;
  const key = process.env.ARCA_KEY;
  const cuit = process.env.ARCA_CUIT;

  if (!cert || !key || !cuit) {
    throw new Error(
      "Faltan variables de entorno de ARCA: ARCA_CERT, ARCA_KEY y ARCA_CUIT son obligatorias",
    );
  }

  return { entorno, cert, key, cuit, urls: URLS[entorno] };
}
