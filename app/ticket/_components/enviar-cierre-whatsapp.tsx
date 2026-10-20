"use client";

import { useState } from "react";

// El cierre no se termina hasta que el dueño lo tiene (pedido del usuario
// 2026-10-19). Por eso en el cierre de hoy esto no es un botón más al lado
// de "Imprimir": es una tarea pendiente, en rojo, arriba de todo, que se
// queda ahí hasta que se toca.
//
// Lo que el sistema puede garantizar y lo que no: con un link wa.me se
// puede abrir el chat con el mensaje ya escrito, y eso es lo que hace el
// botón. Apretar "enviar" dentro de WhatsApp lo hace la persona, y ningún
// sistema lo puede hacer por ella sin la API de WhatsApp Business. Por eso
// el texto se lo recuerda en lugar de dar por hecho que salió.
//
// El estado "ya lo mandé" vive solo en esta pantalla y no se guarda: si se
// recarga, el aviso vuelve. Es a propósito -- ante la duda, que lo mande
// dos veces y no que se pierda.
export function EnviarCierreWhatsapp({
  link,
  nombreDueno,
}: {
  // null si falta WHATSAPP_DUENO: ahí no hay a quién mandarle y lo que
  // corresponde es avisar que está sin configurar, no esconder el paso.
  link: string | null;
  nombreDueno: string | null;
}) {
  const [enviado, setEnviado] = useState(false);
  const aQuien = nombreDueno ? `a ${nombreDueno}` : "al dueño";

  if (!link) {
    return (
      <div className="no-print mb-4 rounded-card border border-warn/40 bg-warn-bg px-[14px] py-[11px]">
        <p className="text-[13px] font-medium text-warn">
          No se puede mandar el cierre por WhatsApp
        </p>
        <p className="mt-[2px] text-[12px] text-warn">
          Falta cargar el teléfono del dueño en la configuración del sistema. Avisá para que lo
          carguen; mientras tanto, mandá el cierre a mano.
        </p>
      </div>
    );
  }

  if (enviado) {
    return (
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-card border border-ok/40 bg-ok-bg px-[14px] py-[11px]">
        <p className="text-[13px] font-medium text-ok">
          Cierre enviado {aQuien}. Revisá que en WhatsApp haya salido.
        </p>
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="text-[12.5px] font-medium text-ok underline"
        >
          Volver a enviar
        </a>
      </div>
    );
  }

  return (
    <div className="no-print mb-4 rounded-card border border-err/40 bg-err-bg px-[14px] py-[12px]">
      <p className="text-[13.5px] font-semibold text-err">Falta mandarle el cierre {aQuien}</p>
      <p className="mb-[10px] mt-[2px] text-[12px] text-err">
        Se abre WhatsApp con el cierre ya escrito. Acordate de tocar enviar.
      </p>
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        onClick={() => setEnviado(true)}
        className="inline-block rounded-[7px] bg-moe px-[16px] py-[9px] text-[13px] font-medium text-white hover:bg-moe/90"
      >
        Enviar por WhatsApp
      </a>
    </div>
  );
}
