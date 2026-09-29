"use client";

import { useEffect, useRef, useState } from "react";

// Lector de códigos de barras con la cámara del celular, usando la API
// nativa del navegador (BarcodeDetector). Sin dependencias: Chrome en
// Android la trae de fábrica.
//
// Safari (iPhone) NO la tiene, así que el botón directamente no se muestra
// ahí -- no hay un fallback a medias que después falle en la mano de
// alguien contando: en iPhone se busca por nombre, o se escanea con la
// pistola del mostrador (que funciona como teclado y no necesita nada de
// esto).
//
// No está en lib.dom de TypeScript todavía, de ahí la declaración mínima.
type CodigoDetectado = { rawValue: string };
type DetectorDeCodigos = { detect: (fuente: HTMLVideoElement) => Promise<CodigoDetectado[]> };
type ConstructorDetector = new (opciones?: { formats?: string[] }) => DetectorDeCodigos;

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

function obtenerConstructor(): ConstructorDetector | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
  return ctor ?? null;
}

export function soportaEscanerCamara(): boolean {
  return obtenerConstructor() !== null && typeof navigator !== "undefined" && !!navigator.mediaDevices;
}

export function EscanerCamara({
  onCodigo,
  onCerrar,
}: {
  onCodigo: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelado = false;

    async function arrancar() {
      const Detector = obtenerConstructor();
      if (!Detector) {
        setError("Este teléfono no puede leer códigos con la cámara.");
        return;
      }
      const detector = new Detector({ formats: FORMATOS });

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        setError("No pudimos abrir la cámara. Revisá los permisos del navegador.");
        return;
      }
      if (cancelado || !videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});

      // Cada 350ms alcanza: más seguido calienta el teléfono sin leer más
      // rápido (el cuello de botella es el enfoque de la cámara).
      timer = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codigos = await detector.detect(videoRef.current);
          const codigo = codigos[0]?.rawValue?.trim();
          if (codigo) onCodigo(codigo);
        } catch {
          // Un frame que no se pudo analizar no es un error: se intenta con
          // el siguiente.
        }
      }, 350);
    }

    arrancar();

    return () => {
      cancelado = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCodigo]);

  return (
    <div className="mt-3 overflow-hidden rounded-[8px] border border-border bg-black">
      {error ? (
        <p className="bg-bg px-[12px] py-[10px] text-[12.5px] text-err">{error}</p>
      ) : (
        <video ref={videoRef} playsInline muted className="block h-[220px] w-full object-cover" />
      )}
      <button
        type="button"
        onClick={onCerrar}
        className="w-full bg-bg-2 py-[9px] text-[13px] font-medium text-text-2"
      >
        Cerrar cámara
      </button>
    </div>
  );
}
