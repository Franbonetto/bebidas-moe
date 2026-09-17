"use client";

export function ImprimirBoton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-[7px] bg-moe px-[16px] py-[9px] text-[13px] font-medium text-white hover:bg-moe/90"
    >
      Imprimir
    </button>
  );
}
