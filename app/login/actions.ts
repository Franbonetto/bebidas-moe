"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Server Action: sign-in y el chequeo de `usuarios` corren en el mismo
// request del servidor, con el mismo cliente. Evita la carrera que existía
// haciéndolo desde el browser (signInWithPassword actualiza el header
// Authorization del cliente REST de forma asíncrona vía onAuthStateChange,
// así que una consulta inmediatamente después podía salir sin sesión y
// auth.uid() volvía null).
export async function login(_prevState: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return "Email o contraseña incorrectos.";
  }

  // La fila propia en `usuarios` solo es visible si activo = true
  // (política usuarios_select -> usuario_activo()). Si no aparece, el
  // usuario no existe en la tabla o está dado de baja: no entra.
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!usuario) {
    await supabase.auth.signOut();
    return "Tu usuario no tiene acceso al sistema. Consultá con el dueño.";
  }

  redirect("/");
}
