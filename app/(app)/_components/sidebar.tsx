"use client";

import { useEffect, useSyncExternalStore } from "react";
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
// Entrada de mercadería, Carga inicial y Proveedores están marcados
// "restringido": solo entran al menú si puedeVerCostos es true (dueño +
// encargado Olavarría, CLAUDE.md), y ni siquiera se muestran inertes para
// el resto -- no deben saber que existen.
// Agrupación pedida por el usuario (ref. Tiqora/Minimercado Abigail):
// Inicio suelto arriba, después Operación, Catálogo y Personas.
// Orden y nombres de Operación pedidos por el usuario 2026-09-28: punto de
// venta, envíos, merma, pedido semanal, entrada de mercadería -- es el
// orden en que se usan en el mostrador, de lo más frecuente a lo más
// esporádico. "Pedidos" pasó a llamarse "Pedido semanal" y "Compras" a
// "Entrada de mercadería", que es como lo nombran ellos.
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
    // Ícono de moto (pedido del usuario 2026-09-28): el envío del local es
    // el motomandado, no un camión.
    icon: "M5.5 19.5a3 3 0 110-6 3 3 0 010 6zM18.5 19.5a3 3 0 110-6 3 3 0 010 6zM5.5 16.5h5.5l3.5-5.5h2M14.5 11l4 5.5M9 11h4M16 8h3",
  },
  {
    label: "Merma",
    href: "/mermas",
    seccion: "operacion",
    // Sin restringir: la registra quien ve romperse la botella, en
    // cualquiera de las dos sucursales. No muestra costos.
    icon: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5",
  },
  {
    label: "Pedido semanal",
    href: "/pedidos",
    seccion: "operacion",
    icon: "M16 3h5v5M4 20L20.5 3.5M21 16v5h-5M15 15l5.5 5.5M4 4l5 5",
  },
  {
    label: "Entrada de mercadería",
    href: "/compras",
    seccion: "operacion",
    restringido: true,
    icon: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0",
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
    label: "Carga inicial",
    href: "/carga-inicial",
    seccion: "catalogo",
    // Incluye el costo: misma población que ve costos (dueño + Olavarría).
    // Es la pantalla del arranque del sistema en cada sucursal -- se usa
    // mucho unos días y después casi nunca.
    restringido: true,
    icon: "M12 5v14M5 12h14",
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
    label: "Balance de IVA",
    href: "/reportes/iva",
    seccion: "catalogo",
    // Rentabilidad global: solo el dueño (CLAUDE.md, matriz de roles). El
    // encargado de Olavarría ve costos y márgenes, no el resultado fiscal.
    soloDueno: true,
    icon: "M19 5L5 19M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  },
  {
    label: "Particulares",
    href: "/reportes/particulares",
    seccion: "catalogo",
    // Lo que se cobró sin estar en el catálogo. Vive bajo /reportes, que es
    // solo del dueño (ver reportes/layout.tsx).
    soloDueno: true,
    icon: "M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6-6.3 4.6L7.9 13.8 2 9.4h7.6z",
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

// Qué secciones del menú dejó desplegadas el usuario en este teléfono.
// Se guarda en el navegador y no en la base: es una preferencia de cómo ve
// el menú en ESE aparato, no un dato del negocio.
//
// Se lee con useSyncExternalStore y no con useState + useEffect por dos
// razones: el render del servidor no puede ver localStorage (devuelve null
// y queda el default, sin desajuste de hidratación), y el lint del
// proyecto no permite setState dentro de un efecto.
const STORAGE_SECCIONES = "moe:menu-secciones";

function esSeccion(valor: unknown): valor is Seccion {
  return valor === "operacion" || valor === "catalogo" || valor === "personas";
}

const oyentes = new Set<() => void>();
let cacheLeido = false;
// null = el usuario todavía no tocó ninguna sección en este navegador.
let cacheSecciones: Seccion[] | null = null;

// useSyncExternalStore compara por referencia, así que esto tiene que
// devolver siempre el mismo array hasta que algo cambie de verdad.
function leerSeccionesGuardadas(): Seccion[] | null {
  if (!cacheLeido) {
    cacheLeido = true;
    try {
      const crudo = window.localStorage.getItem(STORAGE_SECCIONES);
      const parseado: unknown = crudo ? JSON.parse(crudo) : null;
      cacheSecciones = Array.isArray(parseado) ? parseado.filter(esSeccion) : null;
    } catch {
      // Storage bloqueado (incógnito, permisos) o JSON roto: sin preferencia.
      cacheSecciones = null;
    }
  }
  return cacheSecciones;
}

// En el servidor no hay localStorage: sin preferencia, y el primer render
// del navegador usa esto mismo, así que el HTML coincide.
function sinPreferencia(): Seccion[] | null {
  return null;
}

function suscribirSecciones(oyente: () => void) {
  // Otra pestaña abierta en el mismo celular/PC: que el menú no quede
  // desincronizado.
  const alCambiarStorage = (evento: StorageEvent) => {
    if (evento.key !== null && evento.key !== STORAGE_SECCIONES) return;
    cacheLeido = false;
    oyente();
  };
  oyentes.add(oyente);
  window.addEventListener("storage", alCambiarStorage);
  return () => {
    oyentes.delete(oyente);
    window.removeEventListener("storage", alCambiarStorage);
  };
}

function guardarSecciones(secciones: Seccion[]) {
  cacheLeido = true;
  cacheSecciones = secciones;
  try {
    window.localStorage.setItem(STORAGE_SECCIONES, JSON.stringify(secciones));
  } catch {
    // Si no se puede guardar, igual vale para esta sesión.
  }
  for (const oyente of oyentes) oyente();
}

function esItemActivo(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function renderNavItem(item: NavItem, pathname: string, onCerrar?: () => void, badge?: number) {
  const active = item.href ? esItemActivo(item.href, pathname) : false;
  const content = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4 shrink-0">
        <path d={item.icon} />
      </svg>
      {item.label}
      {!!badge && (
        <span className="ml-auto grid h-[17px] min-w-[17px] place-items-center rounded-full bg-err px-1 text-[10.5px] font-semibold leading-none text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
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
  pedidosCompraSinVer = 0,
  abierto = false,
  onCerrar,
}: {
  nombre: string;
  rol: string;
  puedeVerCostos: boolean;
  // Cantidad de pedidos de compra pendientes que el dueño todavía no abrió
  // (pedidos_compra.visto_en null) -- se muestra como badge rojo en
  // "Pedidos" (pedido del usuario 2026-09-22). Siempre 0 para encargados.
  pedidosCompraSinVer?: number;
  // En celular la sidebar es un drawer que arranca oculto (fixed +
  // -translate-x-full) y se muestra con este flag; en desktop (lg:)
  // siempre está visible y fija en el flujo normal, sin importar
  // `abierto`.
  abierto?: boolean;
  onCerrar?: () => void;
}) {
  const pathname = usePathname();

  // Con el drawer abierto el body no scrollea: si no, el dedo arrastra la
  // pantalla de atrás detrás del fondo oscuro y se ve pasar la lista
  // mientras el menú queda quieto.
  useEffect(() => {
    if (!abierto) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [abierto]);

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

  // En celular las secciones se pliegan: con OPERACIÓN, CATÁLOGO y
  // PERSONAS abiertas a la vez el menú ocupa el alto entero del teléfono
  // (pedido del usuario 2026-10-15). En desktop esto no se aplica: los
  // ítems van `lg:flex`, siempre visibles, que es donde sobra lugar.
  const guardadas = useSyncExternalStore(suscribirSecciones, leerSeccionesGuardadas, sinPreferencia);

  const seccionDelPathname =
    nav.find((item) => item.href && item.seccion && esItemActivo(item.href, pathname))?.seccion ?? null;

  // Mientras el usuario no haya plegado nada, queda abierta la sección
  // donde está parado, para que vea dónde está sin tener que abrir nada.
  const desplegadas = guardadas ?? (seccionDelPathname ? [seccionDelPathname] : []);

  function alternarSeccion(seccion: Seccion) {
    guardarSecciones(
      desplegadas.includes(seccion)
        ? desplegadas.filter((s) => s !== seccion)
        : [...desplegadas, seccion],
    );
  }

  return (
    <>
      {/* Fondo oscuro del drawer. Va al 55%: con 30% la pantalla de atrás
          (en /precios, las tablas de precios y de categorías, llenas de
          números e inputs) seguía legible al costado del menú y no se leía
          como "menú abierto sobre la página" sino como dos cosas a la vez
          -- pedido del usuario 2026-10-15. */}
      {abierto && (
        <div className="fixed inset-0 z-[45] bg-black/55 lg:hidden" onClick={onCerrar} aria-hidden="true" />
      )}
      {/* z-[45], no z-40: /inventarios tiene su barra de acciones fija en
          z-40 y, al ir después en el DOM, se dibujaba por encima del menú
          abierto. Queda arriba de eso y abajo de los modales (z-50).
          En celular el drawer ocupa casi todo el ancho (hasta 300px) para
          que la pantalla de atrás desaparezca de verdad; en desktop
          vuelve a los 216px de siempre, fijo en el flujo normal.
          overflow-y-auto: en un teléfono bajo, el menú completo del dueño
          no entra y si no scrollea quedan ítems inalcanzables. */}
      <aside
        className={`fixed inset-y-0 left-0 z-[45] flex w-[min(86vw,300px)] shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-2 p-3 transition-transform duration-200 lg:static lg:w-[216px] lg:translate-x-0 lg:overflow-visible ${
          abierto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-2 pb-4 pt-1 text-[15px] font-bold tracking-tight text-text">
          <Image src="/logo-moe.png" alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0" priority />
          Bebidas Moe
        </div>

        <nav className="flex flex-col gap-px">
          {inicio.map((item) => renderNavItem(item, pathname, onCerrar))}
          {secciones.map(({ seccion, items }) => {
            const desplegada = desplegadas.includes(seccion);
            // El badge de pedidos sin ver no puede quedar escondido dentro
            // de una sección plegada: si está cerrada, se muestra en el
            // título. En desktop nunca se pliega, así que ahí sobra.
            const badgeSeccion =
              items.some((item) => item.href === "/pedidos") && !desplegada ? pedidosCompraSinVer : 0;

            return (
              <div key={seccion} className="mt-3 flex flex-col gap-px first:mt-0">
                <button
                  type="button"
                  onClick={() => alternarSeccion(seccion)}
                  aria-expanded={desplegada}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2 py-[9px] text-left text-[10.5px] font-semibold tracking-wide text-moe active:bg-[#EFEFF1] lg:pointer-events-none lg:py-0 lg:pb-1"
                >
                  {SECCION_LABEL[seccion]}
                  {!!badgeSeccion && (
                    <span className="ml-auto grid h-[17px] min-w-[17px] place-items-center rounded-full bg-err px-1 text-[10.5px] font-semibold leading-none text-white lg:hidden">
                      {badgeSeccion > 9 ? "9+" : badgeSeccion}
                    </span>
                  )}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 shrink-0 text-text-3 transition-transform duration-150 lg:hidden ${
                      badgeSeccion ? "" : "ml-auto"
                    } ${desplegada ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                <div className={`flex-col gap-px ${desplegada ? "flex" : "hidden lg:flex"}`}>
                  {items.map((item) =>
                    renderNavItem(
                      item,
                      pathname,
                      onCerrar,
                      item.href === "/pedidos" ? pedidosCompraSinVer : undefined,
                    ),
                  )}
                </div>
              </div>
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
    </>
  );
}
