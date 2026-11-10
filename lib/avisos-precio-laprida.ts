import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "./supabase/traer-todo";

// Avisos pendientes de "cambiar el cartel de góndola" en Laprida (pedido
// del usuario 2026-11-05). Se usa desde Inicio, Alertas y Precios, así
// que vive en lib/ y no dentro de una sola pantalla.

// Un aviso por producto o promoción (2026-11-10): cada vez que se guarda un
// precio se genera una fila nueva, así que el mismo producto podía aparecer
// varias veces (precio base + excepción + guardados repetidos) y el contador
// mostraba cientos de "cambios" que eran decenas de carteles. `ids` son todas
// las filas pendientes que se resuelven juntas al cambiar ese cartel.
export type AvisoPrecioLaprida = {
  id: string;
  ids: string[];
  // De qué es el cartel: un SKU o una promoción (uno solo de los dos). Lo usa
  // el botón "Ver precio" para buscar el precio que rige hoy.
  skuId: string | null;
  promocionId: string | null;
  titulo: string;
  descripcion: string;
  generadoEn: string;
};

// Lo que muestra "Ver precio": el precio que rige HOY en Laprida, no el que
// había cuando se generó el aviso (el aviso no guarda precio anterior ni
// nuevo, ver 20261105090000_avisos_precio_laprida.sql). Nunca lleva costos.
export type PrecioParaCartel = {
  // Precio de lista (el que pagan débito, crédito, transferencia y QR).
  precio: number | null;
  // Precio en efectivo, solo si es distinto del de lista.
  precioEfectivo: number | null;
  promociones: {
    nombre: string;
    detalle: string;
    total: number | null;
    // "hasta dd/mm/aaaa" o null si es permanente.
    vigencia: string | null;
    vigente: boolean;
  }[];
};

type AvisoFila = {
  id: string;
  descripcion: string;
  generado_en: string;
  sku_id: string | null;
  promocion_id: string | null;
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
        `id, descripcion, generado_en, sku_id, promocion_id,
         sku:skus ( nombre ),
         promocion:promociones ( nombre )`,
      )
      .is("resuelto_en", null)
      .order("generado_en", { ascending: false }),
  );

  // Viene ordenado del más nuevo al más viejo: el grupo queda en la posición
  // de su aviso más reciente.
  const grupos = new Map<string, AvisoPrecioLaprida>();
  for (const a of (data ?? []) as unknown as AvisoFila[]) {
    const clave = a.sku_id ? `sku:${a.sku_id}` : `promo:${a.promocion_id ?? a.id}`;
    const existente = grupos.get(clave);
    if (existente) {
      existente.ids.push(a.id);
      const motivos = existente.descripcion.split(" · ");
      if (!motivos.includes(a.descripcion)) existente.descripcion += ` · ${a.descripcion}`;
    } else {
      grupos.set(clave, {
        id: a.id,
        ids: [a.id],
        skuId: a.sku_id,
        promocionId: a.promocion_id,
        titulo: a.sku?.nombre ?? a.promocion?.nombre ?? "Producto eliminado",
        descripcion: a.descripcion,
        generadoEn: a.generado_en,
      });
    }
  }
  return [...grupos.values()];
}
