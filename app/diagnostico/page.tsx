import { ContadorPrueba } from "./contador-prueba";

// Pantalla de diagnóstico del navegador. No es parte del sistema: existe
// para que, cuando algo "no anda en ese celular", se pueda ver QUÉ no anda
// en vez de adivinar (2026-10-15: en un Motorola el menú lateral no se
// escondía nunca y el botón de cerrar "no hacía nada").
//
// Vive fuera de (app) a propósito: sin sidebar ni header, así se puede
// mirar aunque justamente el menú sea lo que está roto.
//
// Las dos pruebas son distintas y hay que leerlas juntas:
//   1. El bloque de arriba lo llena un <script> suelto: si está vacío, el
//      navegador no ejecutó NADA de JavaScript.
//   2. El contador es React: si el script anduvo pero el botón no suma,
//      el problema es la hidratación (el bundle de la app), no el celular.
export default function DiagnosticoPage() {
  const script = `
    (function () {
      function linea(etiqueta, valor) {
        var fila = document.createElement("div");
        fila.style.cssText = "display:flex;gap:8px;justify-content:space-between;border-bottom:1px solid #E5E5E7;padding:6px 0";
        var a = document.createElement("span");
        a.style.cssText = "color:#71717A;flex:0 0 auto";
        a.textContent = etiqueta;
        var b = document.createElement("span");
        b.style.cssText = "text-align:right;word-break:break-word";
        b.textContent = valor;
        fila.appendChild(a);
        fila.appendChild(b);
        document.getElementById("js-basico").appendChild(fila);
      }
      function soporta(prop, valor) {
        try {
          return window.CSS && CSS.supports && CSS.supports(prop, valor) ? "SÍ" : "NO";
        } catch (e) {
          return "NO";
        }
      }
      function rango() {
        try {
          return window.matchMedia("(width >= 1px)").matches ? "SÍ" : "NO";
        } catch (e) {
          return "NO";
        }
      }
      function storage() {
        try {
          window.localStorage.setItem("moe:prueba", "1");
          window.localStorage.removeItem("moe:prueba");
          return "SÍ";
        } catch (e) {
          return "NO";
        }
      }
      linea("JavaScript suelto", "SÍ");
      linea("Ancho de pantalla", window.innerWidth + " x " + window.innerHeight);
      linea("translate (esconde el menú)", soporta("translate", "-100% 0"));
      linea("color-mix (fondo oscuro)", soporta("color", "color-mix(in oklab, red 50%, transparent)"));
      linea("dvh (alto del menú)", soporta("height", "100dvh"));
      linea("media (width >= 64rem)", rango());
      linea("Guardar preferencias", storage());
      linea("Navegador", navigator.userAgent);
    })();
  `;

  return (
    <div className="mx-auto max-w-[520px] p-4 text-[13.5px] text-text">
      <h1 className="text-[17px] font-semibold">Diagnóstico del navegador</h1>
      <p className="mt-1 text-[13px] text-text-3">
        Sacale una foto a esta pantalla entera y mandámela. No toca ningún dato del sistema.
      </p>

      <h2 className="mt-5 text-[13px] font-semibold">1. Lo que soporta este celular</h2>
      <div id="js-basico" className="mt-1 rounded-card border border-border bg-bg p-3 tabular-nums" />
      <noscript>
        <p className="mt-1 rounded-card border border-err bg-err-bg p-3 text-err">
          Este navegador tiene JavaScript desactivado: el sistema no puede funcionar así.
        </p>
      </noscript>
      <p className="mt-1 text-[12px] text-text-3">
        Si este cuadro quedó vacío, el navegador no ejecutó nada de JavaScript.
      </p>

      <h2 className="mt-5 text-[13px] font-semibold">2. Si responden los botones</h2>
      <ContadorPrueba />

      <script dangerouslySetInnerHTML={{ __html: script }} />
    </div>
  );
}
