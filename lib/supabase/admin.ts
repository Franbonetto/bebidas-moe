import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente con la service role key: bypassea RLS por completo. Importar
// SOLO desde archivos "use server" (actions.ts) -- nunca desde un
// componente cliente. No lleva el paquete "server-only" (evitamos sumar
// una dependencia sin avisar); el propio nombre del archivo y esta nota
// son la barrera.
//
// Uso exclusivo: acciones que ya verificaron es_dueno() con el cliente
// normal (RLS) y necesitan además tocar auth.users (crear/editar un
// login), algo que ninguna clave pública puede hacer.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno del servidor",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
