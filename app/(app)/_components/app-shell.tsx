"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

export function AppShell({
  nombre,
  rol,
  puedeVerCostos,
  pedidosCompraSinVer,
  children,
}: {
  nombre: string;
  rol: string;
  puedeVerCostos: boolean;
  pedidosCompraSinVer?: number;
  children: ReactNode;
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const pathname = usePathname();

  // Al pasar a desktop (lg:) la sidebar deja de ser drawer y el fondo
  // oscuro desaparece, así que un menú que quedó "abierto" no se ve pero
  // sigue bloqueando el scroll del body. Pasa de verdad en una tablet que
  // rota de vertical (768) a horizontal (1024).
  useEffect(() => {
    const lg = window.matchMedia("(min-width: 1024px)");
    const cerrarSiDesktop = () => {
      if (lg.matches) setMenuAbierto(false);
    };
    cerrarSiDesktop();
    lg.addEventListener("change", cerrarSiDesktop);
    return () => lg.removeEventListener("change", cerrarSiDesktop);
  }, []);
  // El punto de venta necesita el máximo alto posible para el ticket -- ver
  // comentario en header.tsx.
  const esPuntoDeVenta = pathname === "/vender";

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        nombre={nombre}
        rol={rol}
        puedeVerCostos={puedeVerCostos}
        pedidosCompraSinVer={pedidosCompraSinVer}
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
