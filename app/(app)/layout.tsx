import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { veCostos } from "@/lib/permisos";
import { AppShell } from "./_components/app-shell";

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
  //
  // Va junto con ve_costos() en un solo Promise.all y no una después de la
  // otra: este layout corre en cada navegación, y cada consulta suelta es
  // un viaje de ida y vuelta a Supabase que la cajera espera mirando la
  // pantalla vieja (2026-10-19, junto con el loading.tsx de al lado).
  const [{ data: usuario }, puedeVerCostos] = await Promise.all([
    supabase.from("usuarios").select("nombre, rol").eq("id", user.id).maybeSingle(),
    veCostos(supabase),
  ]);

  if (!usuario) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Badge rojo en "Pedidos" para el dueño: pedidos de compra pendientes
  // que todavía no abrió (pedido del usuario 2026-09-22).
  let pedidosCompraSinVer = 0;
  if (usuario.rol === "dueno") {
    const { count } = await supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("estado", "pendiente")
      .is("visto_en", null);
    pedidosCompraSinVer = count ?? 0;
  }

  return (
    <AppShell
      nombre={usuario.nombre}
      rol={usuario.rol}
      puedeVerCostos={puedeVerCostos}
      pedidosCompraSinVer={pedidosCompraSinVer}
    >
      {children}
    </AppShell>
  );
}
