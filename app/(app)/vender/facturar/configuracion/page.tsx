import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { veCostos } from "@/lib/permisos";
import { ConfiguracionForm } from "./_components/configuracion-form";

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

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];

  const [{ data: puntosVenta }, { data: condiciones }] = await Promise.all([
    supabase.from("puntos_venta").select("sucursal_id, numero_arca, activo"),
    supabase.from("condicion_iva").select("id, codigo_arca, nombre").order("codigo_arca"),
  ]);

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
