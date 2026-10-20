"use client";

import { useEffect, useRef } from "react";

// Abre el diálogo de impresión solo, apenas carga la página.
//
// Lo usa el ticket de cierre de caja, al que se llega con ?imprimir=1
// justo después de cerrarla (pedido del usuario 2026-10-19: "al cerrar
// caja que imprima ticket"). Entrar a la misma URL sin el parámetro no
// dispara nada, así que reimprimir un cierre viejo no te tira el diálogo
// encima sin pedirlo.
//
// No usa window.open desde el cierre porque el navegador bloquea las
// ventanas que se abren después de un await: acá la página ya está
// abierta y el diálogo es parte de su carga.
export function ImprimirAlAbrir() {
  const yaImprimio = useRef(false);

  useEffect(() => {
    // React monta dos veces en desarrollo (StrictMode) y el diálogo es
    // modal: sin esta guarda, aparece dos veces encimado.
    if (yaImprimio.current) return;
    yaImprimio.current = true;

    // Un tick para que la hoja de estilos de impresión ya esté aplicada.
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, []);

  return null;
}
