"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

export function AppShell({
  nombre,
  rol,
  puedeVerCostos,
  children,
}: {
  nombre: string;
  rol: string;
  puedeVerCostos: boolean;
  children: ReactNode;
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const pathname = usePathname();
  // El punto de venta necesita el máximo alto posible para el ticket -- ver
  // comentario en header.tsx.
  const esPuntoDeVenta = pathname === "/vender";

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        nombre={nombre}
        rol={rol}
        puedeVerCostos={puedeVerCostos}
        abierto={menuAbierto}
        onCerrar={() => setMenuAbierto(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* El header con "Bebidas Moe" + buscador quedaba redundante en
            todos los paneles (dueño, Olavarría, Laprida): cada pantalla ya
            tiene su propio título. Se deja solo el botón de menú (visible
            nada más en celular, para poder abrir la sidebar). */}
        <Header onAbrirMenu={() => setMenuAbierto(true)} minimal />
        <main className={esPuntoDeVenta ? "flex-1 p-3 sm:p-5 lg:p-3" : "flex-1 p-3 sm:p-5"}>{children}</main>
      </div>
    </div>
  );
}
