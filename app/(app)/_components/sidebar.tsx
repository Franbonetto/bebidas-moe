"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type NavItem = { label: string; href?: string; icon: string; restringido?: boolean };

// Mismo set de íconos/orden que docs/mockups/paneles.html. El resto de las
// pantallas sin href todavía no existen (se van sumando bloque a bloque),
// así que quedan visibles pero no navegables en vez de llevar a un 404.
// Compras y Proveedores están marcados "restringido": solo entran al menú
// si puedeVerCostos es true (dueño + encargado Olavarría, CLAUDE.md), y ni
// siquiera se muestran inertes para el resto -- no deben saber que existen.
const NAV: NavItem[] = [
  { label: "Inicio", icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  {
    label: "Productos",
    href: "/productos",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  { label: "Stock", icon: "M21 8v13H3V8M1 3h22v5H1zM10 12h4" },
  {
    label: "Ventas",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  },
  {
    label: "Transferencias",
    icon: "M16 3h5v5M4 20L20.5 3.5M21 16v5h-5M15 15l5.5 5.5M4 4l5 5",
  },
  {
    label: "Compras",
    href: "/compras",
    restringido: true,
    icon: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0",
  },
  {
    label: "Proveedores",
    href: "/proveedores",
    restringido: true,
    icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  },
  { label: "Reportes", icon: "M9 11H3v10h6zM15 3H9v18h6zM21 7h-6v14h6z" },
];

const ROL_LABEL: Record<string, string> = {
  dueno: "Dueño",
  encargado: "Encargado",
};

export function Sidebar({
  nombre,
  rol,
  puedeVerCostos,
}: {
  nombre: string;
  rol: string;
  puedeVerCostos: boolean;
}) {
  const pathname = usePathname();
  const nav = NAV.filter((item) => !item.restringido || puedeVerCostos);

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-border bg-bg-2 p-3">
      <div className="flex items-center gap-2 px-2 pb-4 pt-1 text-[15px] font-bold tracking-tight text-text">
        <span className="inline-block h-5 w-5 shrink-0 rounded-[4px] bg-moe" />
        Bebidas Moe
      </div>

      <nav className="flex flex-col gap-px">
        {nav.map((item) => {
          const active = Boolean(item.href) && pathname.startsWith(item.href!);
          const content = (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                className="h-4 w-4 shrink-0"
              >
                <path d={item.icon} />
              </svg>
              {item.label}
            </>
          );
          const base =
            "flex items-center gap-[9px] rounded-[6px] border-l-2 px-2 py-[7px] text-[13.5px] font-medium";

          if (!item.href) {
            return (
              <span
                key={item.label}
                className={`${base} cursor-default border-transparent text-text-3`}
              >
                {content}
              </span>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`${base} ${
                active
                  ? "border-moe bg-moe-soft text-moe"
                  : "border-transparent text-text-2 hover:bg-[#EFEFF1] hover:text-text"
              }`}
            >
              {content}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border pt-2">
        <div className="flex items-center gap-[9px] px-2 py-1 text-[13px]">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#E4E4E7] text-[11px] font-semibold text-text-2">
            {nombre.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{nombre}</p>
            <p className="text-[11.5px] text-text-3">{ROL_LABEL[rol] ?? rol}</p>
          </div>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
