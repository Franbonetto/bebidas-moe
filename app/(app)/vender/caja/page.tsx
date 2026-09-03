import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { operaSucursal } from "@/lib/permisos";
import { CerrarCajaForm } from "./_components/cerrar-caja-form";
import { formatoMoneda } from "../_lib/formato";

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const { sucursal: sucursalParam } = await searchParams;
  const supabase = await createClient();

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("activo", true)
    .order("es_central", { ascending: false });

  const sucursalesList = sucursales ?? [];
  const operables = await Promise.all(sucursalesList.map((s) => operaSucursal(supabase, s.id)));
  const sucursalesOperables = sucursalesList.filter((_, i) => operables[i]);

  if (sucursalesOperables.length === 0) {
    return (
      <div className="rounded-card border border-border bg-bg p-6 text-[13px] text-text-2">
        No tenés ninguna sucursal asignada.
      </div>
    );
  }

  const sucursal =
    sucursalesOperables.find((s) => s.id === sucursalParam) ?? sucursalesOperables[0];

  const { data: caja } = await supabase
    .from("cajas")
    .select("id, estado, efectivo_sistema, efectivo_declarado, diferencia, cantidad_tickets")
    .eq("sucursal_id", sucursal.id)
    .eq("fecha", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  const { data: ventasHoy } = caja?.id
    ? await supabase.from("ventas").select("medio_pago, total").eq("caja_id", caja.id)
    : { data: [] };

  const totalPorMedio = new Map<string, number>();
  let totalGeneral = 0;
  for (const v of ventasHoy ?? []) {
    totalPorMedio.set(v.medio_pago, (totalPorMedio.get(v.medio_pago) ?? 0) + v.total);
    totalGeneral += v.total;
  }

  return (
    <div className="mx-auto max-w-[560px]">
      {sucursalesOperables.length > 1 && (
        <div className="mb-3 flex gap-2">
          {sucursalesOperables.map((s) => (
            <Link
              key={s.id}
              href={`/vender/caja?sucursal=${s.id}`}
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

      <div className="rounded-card border border-border bg-bg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[15px] font-semibold text-text">Caja del día — {sucursal.nombre}</h1>
          <Link href="/vender" className="text-[12.5px] text-text-2 hover:text-text">
            ← Volver a vender
          </Link>
        </div>

        {!caja ? (
          <p className="text-[13px] text-text-2">Todavía no se registró ninguna venta hoy.</p>
        ) : (
          <>
            <div className="mb-4 overflow-hidden rounded-[6px] border border-border">
              {Object.entries(MEDIO_LABEL).map(([id, label]) => (
                <div
                  key={id}
                  className="flex justify-between border-b border-[#F1F1F3] px-[12px] py-[7px] text-[13px] last:border-b-0"
                >
                  <span className="text-text-2">{label}</span>
                  <span className="tabular-nums text-text">
                    {formatoMoneda.format(totalPorMedio.get(id) ?? 0)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between bg-bg-2 px-[12px] py-[7px] text-[13px] font-semibold">
                <span className="text-text">Total del día</span>
                <span className="tabular-nums text-text">{formatoMoneda.format(totalGeneral)}</span>
              </div>
            </div>

            <p className="mb-4 text-[12.5px] text-text-3">
              {caja.cantidad_tickets ?? (ventasHoy ?? []).length} ticket(s) hoy.
            </p>

            {caja.estado === "abierta" ? (
              <CerrarCajaForm
                cajaId={caja.id}
                efectivoSistema={totalPorMedio.get("efectivo") ?? 0}
              />
            ) : (
              <div className="rounded-[6px] bg-bg-2 p-[12px] text-[13px]">
                <p className="mb-1 flex justify-between">
                  <span className="text-text-2">Efectivo según sistema</span>
                  <span className="tabular-nums text-text">
                    {formatoMoneda.format(caja.efectivo_sistema ?? 0)}
                  </span>
                </p>
                <p className="mb-1 flex justify-between">
                  <span className="text-text-2">Efectivo declarado</span>
                  <span className="tabular-nums text-text">
                    {formatoMoneda.format(caja.efectivo_declarado ?? 0)}
                  </span>
                </p>
                <p className="flex justify-between font-medium">
                  <span className="text-text-2">Diferencia</span>
                  <span
                    className={`tabular-nums ${
                      (caja.diferencia ?? 0) === 0
                        ? "text-ok"
                        : (caja.diferencia ?? 0) < 0
                          ? "text-err"
                          : "text-warn"
                    }`}
                  >
                    {formatoMoneda.format(caja.diferencia ?? 0)}
                  </span>
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
