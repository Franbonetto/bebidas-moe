"use client";

import { useState, useTransition } from "react";
import { verificarComprobanteArca } from "../../actions";

export function VerificarArcaButton({ ventaId }: { ventaId: string }) {
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function verificar() {
    startTransition(async () => {
      const respuesta = await verificarComprobanteArca(ventaId);
      if ("error" in respuesta) {
        setResultado({ ok: false, texto: respuesta.error });
        return;
      }
      setResultado({ ok: respuesta.coincide, texto: respuesta.detalle });
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={verificar}
        disabled={pending}
        className="text-[12.5px] font-medium text-moe hover:underline disabled:opacity-60"
      >
        {pending ? "Consultando ARCA…" : "Verificar contra el servicio de consulta de ARCA"}
      </button>
      {resultado && (
        <p className={`mt-1 text-[12.5px] ${resultado.ok ? "text-ok" : "text-err"}`}>{resultado.texto}</p>
      )}
    </div>
  );
}
