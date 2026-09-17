"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-pide los datos del server component cada `intervaloMs` sin que el
// usuario tenga que tocar nada -- "tiempo real" en el sentido práctico de
// un dashboard de negocio (no push instantáneo, ver decisión del bloque).
export function AutoRefresh({ intervaloMs = 30000 }: { intervaloMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervaloMs);
    return () => clearInterval(id);
  }, [router, intervaloMs]);

  return null;
}
