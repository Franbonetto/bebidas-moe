"use client";

import type { ReactNode } from "react";

// Contenedor de los formularios de /precios. En pantalla grande es el modal
// centrado de siempre; en celular es una hoja que sube desde abajo, pegada
// al borde inferior y a todo el ancho.
//
// Por qué hoja y no el mismo modal: un modal de ancho fijo (480/560px) se
// sale de una pantalla de 360px, y centrado verticalmente deja el teclado
// tapando los campos. Pegado abajo, el teclado empuja el contenido y los
// botones quedan donde está el pulgar.
//
// Los dos formularios comparten esto a propósito: si cada uno llevara sus
// clases, en el primer cambio uno queda distinto del otro.
export function HojaModal({
  titulo,
  subtitulo,
  ancho = "480px",
  children,
}: {
  titulo: string;
  subtitulo?: string;
  // Ancho en desktop. En celular siempre ocupa todo.
  ancho?: "480px" | "560px";
  children: ReactNode;
}) {
  // No cierra al tocar el fondo, igual que los dos formularios antes de
  // pasar a esta hoja: acá se tipean varios campos y perderlos por un
  // toque al costado sería peor que tener que buscar el botón. Se sale por
  // Cancelar, que en celular queda abajo, donde está el pulgar.
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4">
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-card border border-border bg-bg p-4 sm:max-h-[90vh] sm:rounded-card sm:p-5 ${
          ancho === "560px" ? "sm:w-[560px]" : "sm:w-[480px]"
        }`}
      >
        <h2 className="mb-1 text-[15px] font-semibold text-text sm:text-[14px]">{titulo}</h2>
        {subtitulo && <p className="mb-4 text-[13px] text-text-3 sm:text-[12px]">{subtitulo}</p>}

        {children}
      </div>
    </div>
  );
}

// Clases compartidas por los campos de los dos formularios.
//
// 16px en celular no es un capricho: Safari en iPhone hace zoom solo al
// enfocar un input de menos de 16px y deja la página corrida. En desktop
// vuelve a 13px, que es la densidad del resto de la pantalla.
export const inputHoja =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[9px] text-[16px] text-text outline-none focus:border-moe sm:py-[6px] sm:text-[13px]";

export const labelHoja = "mb-[4px] block text-[12.5px] font-medium text-text-2 sm:text-[12px]";

// Botones al pie: altura cómoda para el pulgar en celular, compactos en
// desktop.
export const botonPrimario =
  "rounded-[6px] bg-moe px-[14px] py-[10px] text-[14px] font-medium text-white hover:bg-moe/90 disabled:opacity-60 sm:py-[7px] sm:text-[13px]";

export const botonSecundario =
  "rounded-[6px] border border-border bg-bg px-[14px] py-[10px] text-[14px] font-medium text-text hover:bg-bg-2 sm:py-[7px] sm:text-[13px]";
