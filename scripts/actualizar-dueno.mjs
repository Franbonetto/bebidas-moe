// Script de un solo uso: cambia email/contraseña/nombre del dueño usando
// la API de administración de Supabase (service role), porque la UI del
// dashboard no tenía la opción de editar el usuario y auth.users está
// bloqueado a propósito para SQL directo.
//
// Lee todo de .env.local -- ningún dato sensible (service role key,
// contraseña nueva) pasa por el chat. Borrá las variables DUENO_* de
// .env.local (y este archivo, si querés) una vez que confirmes que
// funcionó.
//
// Uso: node scripts/actualizar-dueno.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function cargarEnvLocal() {
  const contenido = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const linea of contenido.split("\n")) {
    const match = linea.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, clave, valorCrudo] = match;
    if (process.env[clave]) continue;
    process.env[clave] = valorCrudo.replace(/^"(.*)"$/s, "$1");
  }
}

cargarEnvLocal();

const UID_DUENO_ACTUAL = "2b860c7f-0a7d-49df-9e2c-38f62c8cd2c6"; // bonettofrancisco@hotmail.com

const {
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  DUENO_EMAIL_NUEVO: emailNuevo,
  DUENO_PASSWORD_NUEVO: passwordNuevo,
  DUENO_NOMBRE_NUEVO: nombreNuevo,
} = process.env;

for (const [nombre, valor] of Object.entries({ url, serviceRoleKey, emailNuevo, passwordNuevo, nombreNuevo })) {
  if (!valor) {
    console.error(`Falta la variable ${nombre} en .env.local`);
    process.exit(1);
  }
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: authData, error: errorAuth } = await supabase.auth.admin.updateUserById(UID_DUENO_ACTUAL, {
  email: emailNuevo,
  password: passwordNuevo,
  email_confirm: true,
});

if (errorAuth) {
  console.error("Error actualizando auth.users:", errorAuth.message);
  process.exit(1);
}

const { error: errorTabla } = await supabase
  .from("usuarios")
  .update({ nombre: nombreNuevo, email: emailNuevo })
  .eq("id", UID_DUENO_ACTUAL);

if (errorTabla) {
  console.error("Error actualizando tabla usuarios:", errorTabla.message);
  console.error("\nEl cambio en Auth SÍ se aplicó. Para sincronizar la tabla `usuarios`, corré esto en el SQL Editor:\n");
  const escapar = (s) => s.replace(/'/g, "''");
  console.error(
    `update usuarios set nombre = '${escapar(nombreNuevo)}', email = '${escapar(emailNuevo)}' where id = '${UID_DUENO_ACTUAL}';`,
  );
  process.exit(1);
}

console.log("Listo. Nuevo email:", authData.user.email, "| Nuevo nombre:", nombreNuevo);
console.log("Probá loguearte con el email y la contraseña nuevos.");
