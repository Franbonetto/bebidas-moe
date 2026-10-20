import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/traer-todo";
import { veCostos } from "@/lib/permisos";
import { configArca, type EntornoArca } from "@/lib/arca/env";
import { ConfiguracionForm } from "./_components/configuracion-form";

// Contra qué ARCA está hablando el sistema. Antes no se podía saber desde
// ninguna pantalla -- había que mirar las variables de entorno del
// servidor -- y es justo el dato del que no querés dudar cuando estás por
// emitir. configArca() revienta si falta alguna variable, así que acá se
// atrapa: la pantalla de configuración tiene que poder abrirse igual
// (y de hecho avisar) cuando la facturación no está configurada.
function leerEntornoArca(): EntornoArca | null {
  try {
    return configArca().entorno;
  } catch {
    return null;
  }
}

const CARTEL_ENTORNO = {
  produccion: {
    className: "border-ok/30 bg-ok-bg text-ok",
    titulo: "Producción — las facturas son reales",
    detalle:
      "Cada comprobante que emitís acá queda registrado en ARCA a nombre de Bebidas Moe. No se puede borrar ni deshacer.",
  },
  homologacion: {
    className: "border-warn/30 bg-warn-bg text-warn",
    titulo: "Homologación — ambiente de prueba",
    detalle:
      "Las facturas que se emitan no tienen validez fiscal: sirven para probar el circuito. Si el negocio está facturando de verdad, esto está mal configurado.",
  },
} as const;

export default async function ConfiguracionFacturacionPage() {
  const supabase = await createClient();

  const puedeConfigurar = await veCostos(supabase);
  if (!puedeConfigurar) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés permiso para configurar la facturación.
      </div>
    );
  }

  const { data: sucursales } = await traerTodo(
    supabase
      .from("sucursales")
      .select("id, nombre")
      .eq("activo", true)
      .order("es_central", { ascending: false }),
  );

  const sucursalesList = sucursales ?? [];

  const [{ data: puntosVenta }, { data: condiciones }] = await Promise.all([
    traerTodo(supabase.from("puntos_venta").select("sucursal_id, numero_arca, activo")),
    traerTodo(supabase.from("condicion_iva").select("id, codigo_arca, nombre").order("codigo_arca")),
  ]);

  const entorno = leerEntornoArca();
  const cartel = entorno ? CARTEL_ENTORNO[entorno] : null;

  const numeroArcaPorSucursal = new Map<string, number>();
  for (const pv of (puntosVenta ?? []) as { sucursal_id: string; numero_arca: number }[]) {
    numeroArcaPorSucursal.set(pv.sucursal_id, pv.numero_arca);
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-text">Configuración de facturación</h1>
        <Link href="/vender/facturar" className="text-[12.5px] text-text-2 hover:text-text">
          ← Volver
        </Link>
      </div>

      {cartel ? (
        <div className={`mb-4 rounded-card border p-[13px] ${cartel.className}`}>
          <p className="text-[13px] font-semibold">{cartel.titulo}</p>
          <p className="mt-[3px] text-[12.5px] opacity-80">{cartel.detalle}</p>
        </div>
      ) : (
        <div className="mb-4 rounded-card border border-err/30 bg-err-bg p-[13px] text-err">
          <p className="text-[13px] font-semibold">La facturación no está configurada</p>
          <p className="mt-[3px] text-[12.5px] opacity-80">
            Faltan las variables de entorno de ARCA en el servidor (certificado, clave, CUIT o
            ambiente). Hasta que estén cargadas no se puede emitir ningún comprobante.
          </p>
        </div>
      )}

      {sucursalesList.length > 0 ? (
        <div className="flex flex-col gap-4">
          {sucursalesList.map((s, i) => (
            <ConfiguracionForm
              key={s.id}
              sucursalId={s.id}
              sucursalNombre={s.nombre}
              numeroArcaActual={numeroArcaPorSucursal.get(s.id) ?? null}
              condiciones={condiciones ?? []}
              mostrarCondicionesIva={i === sucursalesList.length - 1}
            />
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-text-2">No se encontraron sucursales activas.</p>
      )}
    </div>
  );
}
