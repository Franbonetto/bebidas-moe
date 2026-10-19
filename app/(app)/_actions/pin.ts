"use server";

import { verificarPinOperaciones } from "@/lib/pin";

// Lo usa el modal de PIN para validar antes de desbloquear la pantalla.
// Cada acción sensible vuelve a validar el PIN por su cuenta: esto no
// reemplaza esa validación, solo evita que la cajera descubra que tipeó
// mal el PIN recién al final de un formulario largo.
export async function verificarPin(pin: string): Promise<{ error: string } | { ok: true }> {
  return verificarPinOperaciones(pin);
}
