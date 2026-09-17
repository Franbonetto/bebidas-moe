"use client";

import { useState, type ReactNode } from "react";
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
        <Header onAbrirMenu={() => setMenuAbierto(true)} />
        <main className="flex-1 p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
