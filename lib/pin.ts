// PIN de operaciones sensibles.
//
// Pedido del usuario 2026-10-19: entrada de mercadería, ajuste de stock,
// precios, promociones y carga inicial piden un PIN antes de confirmar.
// No es un sistema de permisos (eso ya existe: ver lib/permisos.ts y las
// políticas de RLS) -- es un freno para que nadie cambie un precio o el
// stock de paso, con la sesión de la encargada abierta en el mostrador.
//
// Decisiones del usuario:
//   - El PIN vive en la variable de entorno PIN_OPERACIONES, no en el
//     repo: así no queda escrito en git y se puede cambiar sin tocar
//     código.
//   - Se pide UNA VEZ POR PANTALLA (ver _components/pin-gate.tsx): cargar
//     treinta precios seguidos no puede costar treinta PIN.
//
// Falla CERRADA a propósito: si la variable no está configurada, estas
// operaciones no se habilitan. Es lo contrario de lo cómodo, pero un PIN
// que se saltea solo cuando falta configuración no es un PIN.
//
// Se valida siempre del lado del servidor, en cada acción, aunque la UI ya
// lo haya pedido: el desbloqueo de pantalla es comodidad del navegador, no
// la validación.

export type ResultadoPin = { error: string } | { ok: true };

export function verificarPinOperaciones(pin: string | null | undefined): ResultadoPin {
  const esperado = process.env.PIN_OPERACIONES;

  if (!esperado) {
    return {
      error:
        "Falta configurar el PIN de operaciones en el servidor (PIN_OPERACIONES). Avisale a Francisco.",
    };
  }

  if (!pin || pin.trim() !== esperado.trim()) {
    return { error: "PIN incorrecto." };
  }

  return { ok: true };
}
