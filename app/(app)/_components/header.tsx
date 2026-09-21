"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, string> = {
  "/": "Inicio",
  "/productos": "Productos",
  "/proveedores": "Proveedores",
  "/compras": "Compras",
  "/compras/nueva": "Nueva compra",
  "/pedidos": "Pedidos",
  "/pedidos/nuevo": "Nuevo pedido",
  "/inventarios": "Inventarios",
  "/inventarios/nuevo": "Nuevo inventario",
  "/envases": "Envases",
};

function tituloPara(pathname: string) {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/compras/")) return "Compra";
  if (pathname.startsWith("/pedidos/")) return "Pedido";
  if (pathname.startsWith("/inventarios/")) return "Inventario";
  return "Bebidas Moe";
}

// El punto de venta (`/vender`) ya trae su propio título y acciones arriba
// del ticket -- este header genérico ahí solo duplicaba "Bebidas Moe" y le
// robaba alto a la pantalla que más necesita espacio vertical (pedido del
// usuario 2026-09-20). `minimal` lo reduce al botón de menú, y ese botón ya
// es `lg:hidden`, así que en desktop el header desaparece del todo; en
// celular sigue disponible para poder abrir la sidebar.
export function Header({ onAbrirMenu, minimal = false }: { onAbrirMenu?: () => void; minimal?: boolean }) {
  const pathname = usePathname();
  const title = tituloPara(pathname);

  return (
    <div
      className={`flex h-[52px] items-center gap-3 border-b border-border bg-bg px-4 sm:gap-4 sm:px-5 ${
        minimal ? "lg:hidden" : ""
      }`}
    >
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Abrir menú"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-text-2 hover:bg-bg-2 lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {!minimal && (
        <>
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-text">{title}</h1>
          <div className="ml-auto hidden max-w-[380px] flex-1 items-center gap-[7px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text-3 sm:flex">
            Buscar producto, proveedor, pedido…
          </div>
        </>
      )}
    </div>
  );
}
