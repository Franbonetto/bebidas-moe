"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type Seccion = "operacion" | "catalogo" | "personas";

type NavItem = {
  label: string;
  href?: string;
  icon: string;
  seccion?: Seccion;
  restringido?: boolean;
  ocultoParaDueno?: boolean;
  soloDueno?: boolean;
};

const SECCION_LABEL: Record<Seccion, string> = {
  operacion: "OPERACIÓN",
  catalogo: "CATÁLOGO",
  personas: "PERSONAS",
};

// Mismo set de íconos que docs/mockups/paneles.html, salvo "Stock": ese
// ítem quedaba sin pantalla propia y duplicaba lo que ya muestra Productos
// (catálogo con stock por sucursal) -- se unificó ahí en vez de construir
// una pantalla aparte (ver histórico de movimientos y alertas de stock
// bajo mínimo/sin stock dentro de la fila de cada SKU en /productos).
// Compras y Proveedores están marcados "restringido": solo entran al menú
// si puedeVerCostos es true (dueño + encargado Olavarría, CLAUDE.md), y ni
// siquiera se muestran inertes para el resto -- no deben saber que existen.
// Agrupación pedida por el usuario (ref. Tiqora/Minimercado Abigail):
// Inicio suelto arriba, después Operación (punto de venta, compras,
// pedidos, en ese orden), Catálogo (productos y el resto del catálogo) y
// Personas (proveedores).
const NAV: NavItem[] = [
  { label: "Inicio", href: "/", icon: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  {
    label: "Punto de venta",
    href: "/vender",
    seccion: "operacion",
    // El dueño no opera caja -- su panel es de lectura (reportes, dinero,
    // stock, movimientos), el POS lo operan los encargados.
    ocultoParaDueno: true,
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  },
  {
    label: "Envíos",
    href: "/envios",
    seccion: "operacion",
    // A diferencia de Punto de venta, acá el dueño SÍ entra -- ve el
    // historial de envíos de las dos sucursales en modo lectura, no arma
    // pedidos (misma pantalla, /envios/page.tsx decide qué mostrarle).
    icon: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  },
  {
    label: "Compras",
    href: "/compras",
    seccion: "operacion",
    restringido: true,
    icon: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0",
  },
  {
    label: "Pedidos",
    href: "/pedidos",
    seccion: "operacion",
    icon: "M16 3h5v5M4 20L20.5 3.5M21 16v5h-5M15 15l5.5 5.5M4 4l5 5",
  },
  {
    label: "Productos",
    href: "/productos",
    seccion: "catalogo",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  {
    label: "Precios",
    href: "/precios",
    seccion: "catalogo",
    icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  },
  {
    label: "Inventarios",
    href: "/inventarios",
    seccion: "catalogo",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5",
  },
  {
    label: "Envases",
    href: "/envases",
    seccion: "catalogo",
    icon: "M8 21h8M12 17v4M4 4h16v10a4 4 0 01-4 4H8a4 4 0 01-4-4z",
  },
  {
    label: "Reportes",
    href: "/alertas",
    seccion: "catalogo",
    icon: "M9 11H3v10h6zM15 3H9v18h6zM21 7h-6v14h6z",
  },
  {
    label: "Usuarios",
    href: "/usuarios",
    seccion: "catalogo",
    soloDueno: true,
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z",
  },
  {
    label: "Proveedores",
    href: "/proveedores",
    seccion: "personas",
    restringido: true,
    icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  },
];

const ROL_LABEL: Record<string, string> = {
  dueno: "Dueño",
  encargado: "Encargado",
};

function renderNavItem(item: NavItem, pathname: string, onCerrar?: () => void) {
  const active = item.href
    ? item.href === "/"
      ? pathname === "/"
      : pathname.startsWith(item.href)
    : false;
  const content = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4 shrink-0">
        <path d={item.icon} />
      </svg>
      {item.label}
    </>
  );
  const base =
    "flex items-center gap-[9px] rounded-[6px] border-l-2 px-2 py-[7px] text-[13.5px] font-medium";

  if (!item.href) {
    return (
      <span key={item.label} className={`${base} cursor-default border-transparent text-text-3`}>
        {content}
      </span>
    );
  }

  return (
    <Link
      key={item.label}
      href={item.href}
      onClick={onCerrar}
      className={`${base} ${
        active
          ? "border-moe bg-moe-soft text-moe"
          : "border-transparent text-text-2 hover:bg-[#EFEFF1] hover:text-text"
      }`}
    >
      {content}
    </Link>
  );
}

export function Sidebar({
  nombre,
  rol,
  puedeVerCostos,
  abierto = false,
  onCerrar,
}: {
  nombre: string;
  rol: string;
  puedeVerCostos: boolean;
  // En celular la sidebar es un drawer que arranca oculto (fixed +
  // -translate-x-full) y se muestra con este flag; en desktop (lg:)
  // siempre está visible y fija en el flujo normal, sin importar
  // `abierto`.
  abierto?: boolean;
  onCerrar?: () => void;
}) {
  const pathname = usePathname();
  const nav = NAV.filter(
    (item) =>
      (!item.restringido || puedeVerCostos) &&
      !(item.ocultoParaDueno && rol === "dueno") &&
      (!item.soloDueno || rol === "dueno"),
  );
  const inicio = nav.filter((item) => !item.seccion);
  const secciones = (["operacion", "catalogo", "personas"] as const)
    .map((seccion) => ({ seccion, items: nav.filter((item) => item.seccion === seccion) }))
    .filter((s) => s.items.length > 0);

  return (
    <>
      {abierto && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={onCerrar} aria-hidden="true" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[216px] shrink-0 flex-col border-r border-border bg-bg-2 p-3 transition-transform duration-200 lg:static lg:translate-x-0 ${
          abierto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-2 pb-4 pt-1 text-[15px] font-bold tracking-tight text-text">
          <Image src="/logo-moe.png" alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0" priority />
          Bebidas Moe
        </div>

        <nav className="flex flex-col gap-px">
          {inicio.map((item) => renderNavItem(item, pathname, onCerrar))}
          {secciones.map(({ seccion, items }) => (
            <div key={seccion} className="mt-3 flex flex-col gap-px first:mt-0">
              <p className="px-2 pb-1 text-[10.5px] font-semibold tracking-wide text-text-3">
                {SECCION_LABEL[seccion]}
              </p>
              {items.map((item) => renderNavItem(item, pathname, onCerrar))}
            </div>
          ))}
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
    </>
  );
}
