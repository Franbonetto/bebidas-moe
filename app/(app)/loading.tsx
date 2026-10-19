// Esqueleto de carga, compartido por todas las pantallas de la app.
//
// Pedido del usuario 2026-10-19: "corregir velocidad de respuesta cuando
// se toca otra categoría". Sin este archivo, el App Router se queda en la
// pantalla vieja mientras el servidor arma la nueva: la cajera toca
// "Precios" y durante un segundo o dos parece que el click no funcionó, así
// que vuelve a tocar. Con un loading.tsx, Next corta al instante y muestra
// esto, y además puede PRECARGAR esta parte cuando el link entra en
// pantalla -- la navegación pasa a sentirse inmediata aunque los datos
// tarden lo mismo.
//
// A propósito es genérico (título + tabla): casi todas las pantallas son
// eso, y un esqueleto que miente menos vale más que uno por pantalla que
// haya que mantener al lado de cada rediseño.
export default function Loading() {
  return (
    <div className="animate-pulse" aria-label="Cargando" role="status">
      <div className="mb-3 h-[18px] w-[190px] rounded-[5px] bg-[#ededf0]" />

      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="border-b border-border px-[14px] py-[11px]">
          <div className="h-[12px] w-[240px] rounded-[4px] bg-[#ededf0]" />
        </div>

        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-[#F1F1F3] px-[14px] py-[12px] last:border-b-0"
          >
            <div className="h-[11px] flex-1 rounded-[4px] bg-[#ededf0]" />
            <div className="hidden h-[11px] w-[110px] rounded-[4px] bg-[#f2f2f4] sm:block" />
            <div className="h-[11px] w-[70px] rounded-[4px] bg-[#f2f2f4]" />
          </div>
        ))}
      </div>
    </div>
  );
}
