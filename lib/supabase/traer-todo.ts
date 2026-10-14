import type { PostgrestError } from "@supabase/supabase-js";

// Supabase corta en 1000 filas toda consulta sin paginar (el "Max rows" de
// PostgREST) y no devuelve error: la fila 1001 simplemente no viene. Un
// catalogo de mas de 1000 SKU se ve incompleto, el stock de un SKU que no
// entro en la pagina queda en 0 y un conteo general parece tener menos
// items de los que tiene. Por eso ninguna consulta de lista se manda
// directo: va envuelta en traerTodo(), que pide pagina por pagina hasta
// que la base no tiene mas para dar.
const FILAS_POR_PAGINA = 1000;

// Postgres no garantiza el mismo orden entre dos consultas con OFFSET si no
// hay ORDER BY, asi que paginar sin orden puede repetir una fila y saltear
// otra. traerTodo() agrega la clave primaria como ultimo criterio de orden
// para que el recorrido sea estable; el orden que ya puso quien llama se
// respeta y manda primero.
const CLAVE_POR_DEFECTO = "id";

// Un .in("venta_id", ids) viaja en la URL. Pasados unos cientos de UUID la
// request se pasa del largo maximo y falla entera (414), asi que las listas
// de ids se mandan en lotes.
const IDS_POR_LOTE = 500;

type RespuestaLista<T> = { data: T[] | null; error: PostgrestError | null };

type ConsultaPaginable<T> = {
  order(columna: string, opciones: { ascending: boolean }): ConsultaPaginable<T>;
  range(desde: number, hasta: number): PromiseLike<RespuestaLista<T>>;
};

/**
 * Trae todas las filas de una consulta, sin el tope de 1000 de Supabase.
 *
 * Devuelve `{ data, error }` igual que la consulta original, asi que
 * reemplaza al `await supabase.from(...)` sin tocar nada mas alrededor.
 *
 * @param clave columnas que identifican una fila de forma unica, para que
 * el orden del recorrido sea estable. Por defecto `"id"`; las tablas con
 * clave compuesta la pasan completa (ej. `["sku_id", "sucursal_id"]` en
 * `stock_sucursal`).
 */
export async function traerTodo<T>(
  consulta: ConsultaPaginable<T>,
  clave: string | string[] = CLAVE_POR_DEFECTO,
): Promise<RespuestaLista<T>> {
  let paginable = consulta;
  for (const columna of Array.isArray(clave) ? clave : [clave]) {
    paginable = paginable.order(columna, { ascending: true });
  }

  const filas: T[] = [];

  for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
    const { data, error } = await paginable.range(desde, desde + FILAS_POR_PAGINA - 1);
    if (error) return { data: null, error };

    const pagina = data ?? [];
    filas.push(...pagina);

    // Una pagina incompleta es la ultima: no hay mas filas que pedir.
    if (pagina.length < FILAS_POR_PAGINA) break;
  }

  return { data: filas, error: null };
}

/**
 * Igual que traerTodo(), para consultas filtradas por una lista de ids
 * (`.in(...)`) que puede ser larga: parte la lista en lotes para no pasarse
 * del largo maximo de la URL y pagina cada lote.
 *
 * @param consulta recibe un lote de ids y devuelve la consulta ya armada.
 */
export async function traerTodoPorLotes<T>(
  ids: string[],
  consulta: (lote: string[]) => ConsultaPaginable<T>,
  clave: string | string[] = CLAVE_POR_DEFECTO,
): Promise<RespuestaLista<T>> {
  const filas: T[] = [];

  for (let desde = 0; desde < ids.length; desde += IDS_POR_LOTE) {
    const lote = ids.slice(desde, desde + IDS_POR_LOTE);
    const { data, error } = await traerTodo(consulta(lote), clave);
    if (error) return { data: null, error };
    filas.push(...(data ?? []));
  }

  return { data: filas, error: null };
}
