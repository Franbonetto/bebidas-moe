// Fecha de vencimiento tipeada a mano, siempre dd/mm/aaaa.
//
// El <input type="date"> nativo muestra mm/dd/aaaa o dd/mm/aaaa según el
// idioma configurado en el navegador del que carga, no algo que controlemos
// desde el HTML (el atributo lang no lo cambia) -- para garantizar
// dd/mm/aaaa siempre, sin importar esa configuración, se usa un campo de
// texto con formato controlado (pedido del usuario 2026-09-22).
//
// Vive acá y no dentro de un componente porque lo usan las dos pantallas
// que cargan vencimientos: "Cargar mercadería" y "Carga inicial".

export function formatearFechaVencimiento(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 8);
  const dd = digitos.slice(0, 2);
  const mm = digitos.slice(2, 4);
  const aaaa = digitos.slice(4, 8);
  return [dd, mm, aaaa].filter(Boolean).join("/");
}

export function fechaVencimientoValida(valor: string): boolean {
  return valor === "" || /^\d{2}\/\d{2}\/\d{4}$/.test(valor);
}

export function fechaVencimientoAIso(valor: string): string | null {
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  return `${aaaa}-${mm}-${dd}`;
}

export function fechaVencimientoDesdeIso(iso: string | null): string {
  if (!iso) return "";
  const [aaaa, mm, dd] = iso.split("-");
  return `${dd}/${mm}/${aaaa}`;
}
