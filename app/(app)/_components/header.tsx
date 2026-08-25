"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, string> = {
  "/productos": "Productos",
  "/proveedores": "Proveedores",
  "/compras": "Compras",
  "/compras/nueva": "Nueva compra",
  "/pedidos": "Pedidos",
  "/pedidos/nuevo": "Nuevo pedido",
  "/inventarios": "Inventarios",
  "/inventarios/nuevo": "Nuevo inventario",
};

function tituloPara(pathname: string) {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/compras/")) return "Compra";
  if (pathname.startsWith("/pedidos/")) return "Pedido";
  if (pathname.startsWith("/inventarios/")) return "Inventario";
  return "Bebidas Moe";
}

export function Header() {
  const pathname = usePathname();
  const title = tituloPara(pathname);

  return (
    <div className="flex h-[52px] items-center gap-4 border-b border-border bg-bg px-5">
      <h1 className="text-[15px] font-semibold tracking-tight text-text">{title}</h1>
      <div className="ml-auto flex max-w-[380px] flex-1 items-center gap-[7px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text-3">
        Buscar producto, proveedor, pedido…
      </div>
    </div>
  );
}
