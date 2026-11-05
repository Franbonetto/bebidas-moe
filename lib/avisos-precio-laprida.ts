import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "./supabase/traer-todo";

// Avisos pendientes de "cambiar el cartel de góndola" en Laprida (pedido
// del usuario 2026-11-05). Se usa desde Inicio, Alertas y Precios, así
// que vive en lib/ y no dentro de una sola pantalla.

export type AvisoPrecioLaprida = {
  id: string;
  titulo: string;
  descripcion: string;
  generadoEn: string;
};

type AvisoFila = {
  id: string;
  descripcion: string;
  generado_en: string;
  sku: { nombre: string } | null;
  promocion: { nombre: string } | null;
};

export async function avisosPrecioLapridaPendientes(
  supabase: SupabaseClient,
): Promise<AvisoPrecioLaprida[]> {
  const { data } = await traerTodo(
    supabase
      .from("avisos_precio_laprida")
      .select(
        `id, descripcion, generado_en,
         sku:skus ( nombre ),
         promocion:promociones ( nombre )`,
      )
      .is("resuelto_en", null)
      .order("generado_en", { ascending: false }),
  );

  return ((data ?? []) as unknown as AvisoFila[]).map((a) => ({
    id: a.id,
    titulo: a.sku?.nombre ?? a.promocion?.nombre ?? "Producto eliminado",
    descripcion: a.descripcion,
    generadoEn: a.generado_en,
  }));
}
