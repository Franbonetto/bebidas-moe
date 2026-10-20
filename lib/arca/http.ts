// POST de SOAP contra ARCA, con el handshake TLS acotado a mano.
//
// POR QUÉ NO ALCANZA CON fetch() (2026-10-20, día 1 de producción):
//
// `servicios1.afip.gov.ar` -el endpoint de facturación de PRODUCCIÓN-
// ofrece, entre otros, cifrados DHE con una clave Diffie-Hellman más
// chica que el mínimo que aceptan los clientes TLS modernos. Si uno le
// manda la lista de cifrados por defecto, el servidor elige uno de esos
// y OpenSSL corta el handshake con "dh key too small". En Node eso
// aparece como un escueto `fetch failed`, sin pista de qué pasó, y
// desde afuera parece que ARCA está caído.
//
// Lo vivimos el primer día de producción: TODAS las ventas con tarjeta,
// QR y transferencia quedaron sin facturar con `fetch failed`, mientras
// que homologación -que negocia ECDHE sin drama- había funcionado
// perfecto durante un mes.
//
// La solución es acotar la lista de cifrados a ECDHE: el servidor
// soporta ECDHE-RSA-AES256-GCM-SHA384 sin problema, solo hay que no
// darle la opción de elegir el viejo. Verificado contra los cuatro
// endpoints (homologación y producción) el 2026-10-20.
//
// ESTO NO DEBILITA LA CONEXIÓN, LA FORTALECE. Hay recetas dando vueltas
// que "arreglan" esto con SECLEVEL=1 o directamente apagando la
// verificación del certificado (verify_peer => false). Acá se hace al
// revés: se EXIGEN los cifrados fuertes y la verificación del
// certificado del servidor queda intacta (`rejectUnauthorized` sigue en
// su default, true). Nunca apagar eso: sin verificar el certificado,
// cualquiera que se meta en el medio puede hacerse pasar por ARCA.
//
// Se usa node:https en vez de fetch porque fetch (undici) no deja tocar
// las opciones de TLS sin un dispatcher propio, y eso implicaría
// depender de undici directamente.

import https from "node:https";

// Solo ECDHE con AEAD. En este orden: el servidor elige el primero que
// soporta, y los cuatro endpoints de ARCA soportan el primero.
const CIPHERS_ARCA = [
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES256-SHA384",
  "ECDHE-RSA-AES128-SHA256",
].join(":");

export type RespuestaSoap = { ok: boolean; status: number; texto: string };

export async function postSoap(opts: {
  url: string;
  cuerpo: string;
  soapAction: string;
  timeoutMs: number;
  // Para los mensajes de error: "WSAA", "WSFEv1 (FECAESolicitar)", etc.
  nombre: string;
}): Promise<RespuestaSoap> {
  const { url, cuerpo, soapAction, timeoutMs, nombre } = opts;

  return new Promise<RespuestaSoap>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(cuerpo),
          SOAPAction: soapAction,
        },
        ciphers: CIPHERS_ARCA,
        minVersion: "TLSv1.2",
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (trozo) => {
          texto += trozo;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, texto });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${nombre} no respondió en ${timeoutMs / 1000} segundos`));
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      // El motivo real va en el mensaje, no un "fetch failed" pelado:
      // este bloque ya nos costó una tarde de producción a ciegas.
      const detalle = err.code ? `${err.code}: ${err.message}` : err.message;
      reject(new Error(`No se pudo conectar con ${nombre} — ${detalle}`));
    });

    req.end(cuerpo);
  });
}
