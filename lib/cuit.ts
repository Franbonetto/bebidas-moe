// Validación del CUIT: formato y dígito verificador.
//
// Es validación LOCAL, no consulta el padrón de ARCA (eso está anotado
// como pendiente en docs/arquitectura.md, "Requisitos técnicos de ARCA
// relevados"). O sea: detecta un CUIT mal tipeado, no un CUIT que no
// exista. Igual resuelve el caso que importa en el mostrador — un
// dígito cambiado de lugar — antes de que ARCA rechace la factura con
// el cliente esperando, y antes de guardar basura en la libreta de
// clientes.

// Pesos del cálculo de módulo 11, en el orden de los primeros 10
// dígitos del CUIT.
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// "20322702834" -> "20-32270283-4", que es como se lee y se dicta.
export function formatearCuit(cuit: string): string {
  const digitos = soloDigitos(cuit);
  if (digitos.length !== 11) return cuit;
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}

export function cuitEsValido(valor: string): boolean {
  const digitos = soloDigitos(valor);
  if (digitos.length !== 11) return false;

  const suma = PESOS.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
  const resto = suma % 11;

  // Regla de ARCA: resto 0 -> verificador 0; resto 1 -> verificador 9
  // (el caso del 11 - 1 = 10, que no es un dígito); si no, 11 - resto.
  const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;

  return verificador === Number(digitos[10]);
}

// Mensaje en criollo para la pantalla, o null si está bien (CLAUDE.md:
// "Español natural, no jerga técnica").
export function errorDeCuit(valor: string): string | null {
  const digitos = soloDigitos(valor);
  if (digitos.length === 0) return "Falta el CUIT.";
  if (digitos.length !== 11) return "El CUIT tiene que tener 11 números.";
  if (!cuitEsValido(digitos)) return "Ese CUIT no es válido, fijate si hay algún número cambiado.";
  return null;
}
