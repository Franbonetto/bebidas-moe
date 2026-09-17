// Código QR obligatorio en todo comprobante (RG 4892/2020). Formato fijo
// de ARCA: un JSON con estos campos exactos, codificado en base64 y
// puesto como parámetro `p` de la URL pública de consulta.
//
// Referencia: docs/arquitectura.md 1.8 ("El código QR en el comprobante
// es obligatorio"). Verificar en el testing de este bloque que decodifica
// bien contra un comprobante real (checklist del bloque, punto 8).

export type DatosQr = {
  fecha: string; // "AAAA-MM-DD"
  cuitEmisor: string;
  ptoVta: number;
  tipoCmp: number; // 1 = Factura A, 6 = Factura B
  nroCmp: number;
  importeTotal: number;
  tipoDocReceptor: number; // 80 = CUIT, 99 = Consumidor Final
  nroDocReceptor: string;
  cae: string;
};

export function construirQrUrl(datos: DatosQr): string {
  const payload = {
    ver: 1,
    fecha: datos.fecha,
    cuit: Number(datos.cuitEmisor),
    ptoVta: datos.ptoVta,
    tipoCmp: datos.tipoCmp,
    nroCmp: datos.nroCmp,
    importe: datos.importeTotal,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: datos.tipoDocReceptor,
    nroDocRec: Number(datos.nroDocReceptor),
    tipoCodAut: "E",
    codAut: Number(datos.cae),
  };

  const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}
