import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { operaSucursal, veCostos } from "@/lib/permisos";
import { cargarDatosVenta } from "./_lib/cargar-datos-venta";
import { PosClient } from "./_components/pos-client";

// Cobrar ahora puede incluir el pedido de CAE a ARCA (facturación
// automática de lo que no es efectivo, 2026-10-19): la llamada tiene un
// tope propio de 15s en lib/arca/wsfe.ts, y esto le da aire a la función
// de Vercel para que ese tope se cumpla ADENTRO del server action.
//
// Importa que sea así y no al revés: si la plataforma cortara la función
// antes, la venta ya estaría grabada en la base pero el POS mostraría un
// error, y la cajera podría cobrarla de nuevo -- una venta duplicada con
// su descuento de stock. El que corta primero tiene que ser siempre
// nuestro timeout, que devuelve la venta hecha y el comprobante en `error`.
//
// 30s no alcanzaban (2026-10-20): facturar son hasta TRES llamadas con
// 15s de tope cada una -- login WSAA si el token esta vencido,
// FECompUltimoAutorizado para saber el numero, y FECAESolicitar. Con ARCA
// lento eso pasa los 30s, la plataforma cortaba la request y la cajera
// veia un error por una venta que si se habia grabado. 60 es el techo del
// plan Hobby de Vercel, asi que es lo mas que se le puede dar.
//
// Aun asi, el corte no puede duplicar la venta: el reintento viaja con la
// misma clave de idempotencia y confirmar_venta() devuelve la venta que ya
// existe (20261020130000_venta_idempotente.sql). Esto es para que la
// cajera no vea el error, no para evitar el duplicado.
export const maxDuration = 60;

export default async function VenderPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal: sucursalParam } = await searchParams;
  const supabase = await createClient();

  const { data: sucursales } = await traerTodo(
    supabase
      .from("sucursales")
      .select("id, nombre, es_central")
      .eq("activo", true)
      .order("es_central", { ascending: false }),
  );

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés ninguna sucursal asignada para vender.
      </div>
    );
  }

  const sucursal =
    sucursalesOperables.find((s) => s.id === sucursalParam) ?? sucursalesOperables[0];

  // Quién puede tocar el precio de una línea en el mostrador (recargo por
  // frío y lápiz): dueño y encargado de Olavarría, no Laprida -- decisión
  // del usuario 2026-10-17, mismo permiso que ya gobierna productos y
  // precios. confirmar_venta() lo vuelve a chequear server-side.
  const puedeTocarPrecios = await veCostos(supabase);

  const { skusPos, combos, promosCantidad, puedeFacturar, cajaHoy, cantidadTicketsHoy } =
    await cargarDatosVenta(supabase, sucursal, { incluirCosto: puedeTocarPrecios });

  // Quién abre la caja (empleados de esta sucursal), que no es lo mismo que
  // con qué cuenta se entró al sistema -- ver 20261008090000_empleado_caja.
  const { data: empleados } = await traerTodo(
    supabase
      .from("empleados")
      .select("id, nombre")
      .eq("sucursal_id", sucursal.id)
      .eq("activo", true)
      .order("nombre"),
  );

  return (
    <div>
      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/vender?sucursal=${s.id}`}
              className={`rounded-[6px] border px-[10px] py-[4px] text-[12px] font-medium ${
                s.id === sucursal.id
                  ? "border-moe bg-moe-soft text-moe"
                  : "border-border bg-bg text-text-2 hover:bg-bg-2"
              }`}
            >
              {s.nombre}
            </Link>
          ))}
        </div>
      )}

      <PosClient
        sucursalId={sucursal.id}
        sucursalNombre={sucursal.nombre}
        puedeFacturar={puedeFacturar}
        puedeTocarPrecios={puedeTocarPrecios}
        skus={skusPos}
        combos={combos}
        promosCantidad={promosCantidad}
        // Apertura de caja obligatoria antes de vender: sin fila de hoy
        // todavia no se abrio (antes se abria sola con la primera venta,
        // ver supabase/migrations/20260903100000_apertura_caja.sql).
        estadoCaja={!cajaHoy ? "sin_abrir" : cajaHoy.estado === "abierta" ? "abierta" : "cerrada"}
        cajaId={cajaHoy?.id ?? null}
        cantidadTicketsHoy={cantidadTicketsHoy}
        empleados={empleados ?? []}
      />
    </div>
  );
}
