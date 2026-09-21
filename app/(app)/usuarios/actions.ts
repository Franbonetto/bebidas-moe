"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esDueno } from "@/lib/permisos";

export type NuevoUsuarioInput = {
  nombre: string;
  email: string;
  password: string;
  rol: "dueno" | "encargado";
  sucursalIds: string[];
};

// Crear un usuario implica dar de alta su login real en Supabase Auth
// (email + contraseña) además de la fila en `usuarios` -- eso solo lo
// puede hacer la API de admin con la service role key, ninguna clave
// pública alcanza. Por eso esta acción arranca verificando es_dueno() a
// mano con el cliente normal (RLS) antes de tocar nada con el cliente
// admin, que bypassea RLS por completo.
export async function crearUsuario(
  input: NuevoUsuarioInput,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  if (!(await esDueno(supabase))) {
    return { error: "No tenés permiso para crear usuarios" };
  }

  if (input.rol === "encargado" && input.sucursalIds.length === 0) {
    return { error: "Un encargado/empleado necesita al menos una sucursal asignada" };
  }

  const admin = createAdminClient();

  const { data: authData, error: errorAuth } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });

  if (errorAuth) return { error: errorAuth.message };

  const nuevoId = authData.user.id;

  const { error: errorUsuario } = await admin.from("usuarios").insert({
    id: nuevoId,
    nombre: input.nombre,
    email: input.email,
    rol: input.rol,
    activo: true,
  });

  if (errorUsuario) {
    // El login ya se creó en Auth -- si falla la fila de negocio, deshacemos
    // el alta de Auth para no dejar una cuenta fantasma sin fila en usuarios.
    await admin.auth.admin.deleteUser(nuevoId);
    return { error: errorUsuario.message };
  }

  if (input.sucursalIds.length > 0) {
    const { error: errorAsignacion } = await admin
      .from("usuario_sucursal")
      .insert(input.sucursalIds.map((sucursalId) => ({ usuario_id: nuevoId, sucursal_id: sucursalId })));

    if (errorAsignacion) return { error: errorAsignacion.message };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}

export type EditarUsuarioInput = {
  id: string;
  nombre: string;
  activo: boolean;
  sucursalIds: string[];
};

// Nombre/activo/sucursales SÍ están cubiertos por RLS normal (es_dueno()
// en usuarios y usuario_sucursal) -- no hace falta el cliente admin acá.
export async function actualizarUsuario(
  input: EditarUsuarioInput,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const { error: errorUsuario } = await supabase
    .from("usuarios")
    .update({ nombre: input.nombre, activo: input.activo })
    .eq("id", input.id);

  if (errorUsuario) return { error: errorUsuario.message };

  const { error: errorBorrar } = await supabase
    .from("usuario_sucursal")
    .delete()
    .eq("usuario_id", input.id);

  if (errorBorrar) return { error: errorBorrar.message };

  if (input.sucursalIds.length > 0) {
    const { error: errorAsignacion } = await supabase
      .from("usuario_sucursal")
      .insert(input.sucursalIds.map((sucursalId) => ({ usuario_id: input.id, sucursal_id: sucursalId })));

    if (errorAsignacion) return { error: errorAsignacion.message };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}

// Igual que crear: cambiar la contraseña real vive en auth.users, hace
// falta la API de admin.
export async function resetearPasswordUsuario(
  id: string,
  passwordNuevo: string,
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  if (!(await esDueno(supabase))) {
    return { error: "No tenés permiso para cambiar contraseñas" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password: passwordNuevo });
  if (error) return { error: error.message };

  return { ok: true };
}
