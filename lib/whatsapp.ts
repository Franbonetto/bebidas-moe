// Links de WhatsApp (wa.me). No es la API de WhatsApp Business: es el link
// "click to chat" de siempre, que abre la app con el mensaje ya escrito y
// deja que la persona toque enviar.
//
// Se eligió así a propósito para el cierre de caja (pedido del usuario
// 2026-10-19): no necesita número de empresa, ni plantillas aprobadas por
// Meta, ni un centavo, ni guardar nada. La contra es que alguien tiene que
// apretar "enviar" -- no se manda solo a las 22:30. Si algún día se quiere
// automático, eso sí es la API de Business y es otro proyecto.

// El teléfono del dueño vive en una variable de entorno y NO en el repo:
// es un dato personal y el repo tiene historia para siempre. Si falta, el
// botón no aparece (mismo criterio de falla cerrada que PIN_OPERACIONES).
//
// Acepta cualquier forma razonable de escribirlo -- "2284562976",
// "+54 9 2284 56-2976", "5492284562976" -- y devuelve lo que espera wa.me:
// solo dígitos, con código de país, sin el "+" y sin el 15.
export function telefonoWhatsapp(crudo: string | undefined | null): string | null {
  if (!crudo) return null;

  const digitos = crudo.replace(/\D/g, "");

  // Número argentino tal como se marca acá (área + número, 10 dígitos):
  // 54 de país y el 9 que WhatsApp pide para los móviles.
  if (digitos.length === 10) return `549${digitos}`;

  // Ya trae el 54 pero le falta el 9 de móvil.
  if (digitos.length === 12 && digitos.startsWith("54")) return `549${digitos.slice(2)}`;

  // Ya viene completo (549... o cualquier otro país).
  if (digitos.length >= 11) return digitos;

  return null;
}

export function linkWhatsapp(telefono: string, mensaje: string): string {
  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}
