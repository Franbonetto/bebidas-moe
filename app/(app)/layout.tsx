import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { veCostos } from "@/lib/permisos";
import { Sidebar } from "./_components/sidebar";
import { Header } from "./_components/header";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Segundo chequeo, ahora contra la tabla `usuarios` (RLS via
  // usuario_activo()): cubre al usuario que tenía sesión abierta y fue
  // desactivado después de loguearse.
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, rol")
    .eq("id", user.id)
    .maybeSingle();

  if (!usuario) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  const puedeVerCostos = await veCostos(supabase);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar nombre={usuario.nombre} rol={usuario.rol} puedeVerCostos={puedeVerCostos} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
