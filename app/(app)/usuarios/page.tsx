import { createClient } from "@/lib/supabase/server";
import { esDueno } from "@/lib/permisos";
import { UsuariosTable, type UsuarioRow } from "./_components/usuarios-table";
import { formatoFechaHora } from "../compras/_lib/formato";

export default async function UsuariosPage() {
  const supabase = await createClient();

  if (!(await esDueno(supabase))) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés permiso para ver esta pantalla.
      </div>
    );
  }

  const [{ data: usuariosRaw }, { data: sucursalesRaw }, { data: asignacionesRaw }, { data: ventasRaw }, { data: cajasRaw }] =
    await Promise.all([
      supabase.from("usuarios").select("id, nombre, email, rol, activo").order("rol").order("nombre"),
      supabase.from("sucursales").select("id, nombre").eq("activo", true).order("es_central", { ascending: false }),
      supabase.from("usuario_sucursal").select("usuario_id, sucursal_id"),
      supabase.from("ventas").select("usuario_id, fecha").order("fecha", { ascending: false }),
      supabase
        .from("cajas")
        .select("sucursal_id, estado, abierta_en, usuario_apertura:usuarios!cajas_usuario_apertura_id_fkey ( nombre )")
        .eq("fecha", new Date().toISOString().slice(0, 10)),
    ]);

  const sucursales = sucursalesRaw ?? [];

  const sucursalesPorUsuario = new Map<string, string[]>();
  for (const a of (asignacionesRaw ?? []) as { usuario_id: string; sucursal_id: string }[]) {
    const lista = sucursalesPorUsuario.get(a.usuario_id) ?? [];
    lista.push(a.sucursal_id);
    sucursalesPorUsuario.set(a.usuario_id, lista);
  }

  const ultimaVentaPorUsuario = new Map<string, string>();
  for (const v of (ventasRaw ?? []) as { usuario_id: string; fecha: string }[]) {
    if (!ultimaVentaPorUsuario.has(v.usuario_id)) ultimaVentaPorUsuario.set(v.usuario_id, v.fecha);
  }

  const usuarios: UsuarioRow[] = ((usuariosRaw ?? []) as {
    id: string;
    nombre: string;
    email: string;
    rol: string;
    activo: boolean;
  }[]).map((u) => ({
    ...u,
    sucursalIds: sucursalesPorUsuario.get(u.id) ?? [],
    ultimaVenta: ultimaVentaPorUsuario.get(u.id) ?? null,
  }));

  type CajaFila = {
    sucursal_id: string;
    estado: string;
    abierta_en: string;
    usuario_apertura: { nombre: string } | null;
  };
  const cajaPorSucursal = new Map<string, CajaFila>();
  for (const c of (cajasRaw ?? []) as unknown as CajaFila[]) {
    cajaPorSucursal.set(c.sucursal_id, c);
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[17px] font-semibold text-text">Usuarios y cajas</h1>
      </div>
      <p className="mb-4 text-[13px] text-text-2">Quién puede entrar al sistema y el estado de la caja de hoy.</p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <UsuariosTable usuarios={usuarios} sucursales={sucursales} />

        <div className="rounded-card border border-border bg-bg p-4">
          <h2 className="mb-1 text-[13.5px] font-semibold text-text">Cajas de hoy</h2>
          <p className="mb-3 text-[12px] text-text-3">Una caja por sucursal por día.</p>
          <div className="flex flex-col gap-3">
            {sucursales.map((s) => {
              const caja = cajaPorSucursal.get(s.id);
              return (
                <div key={s.id} className="border-b border-[#F1F1F3] pb-3 last:border-b-0 last:pb-0">
                  <p className="text-[13px] font-medium text-text">{s.nombre}</p>
                  {caja ? (
                    <p className="text-[12px] text-text-3">
                      {caja.estado === "abierta" ? (
                        <>
                          Abierta por {caja.usuario_apertura?.nombre ?? "—"} ·{" "}
                          {formatoFechaHora.format(new Date(caja.abierta_en))}
                        </>
                      ) : (
                        "Cerrada"
                      )}
                    </p>
                  ) : (
                    <p className="text-[12px] text-text-3">Todavía no se abrió hoy.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
