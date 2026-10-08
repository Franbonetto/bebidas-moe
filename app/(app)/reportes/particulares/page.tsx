import { createClient } from "@/lib/supabase/server";
import { formatoMoneda } from "@/app/(app)/compras/_lib/formato";
import { Card, EmptyState, Kpi, KpiGrid, SectionHeader } from "../../_components/dashboard/ui";

// Productos particulares vendidos: lo que se cobró sin que exista en el
// catálogo (picadas, canastas de regalería). Pedido del usuario 2026-10-07.
//
// Es la única forma de ver qué son estas ventas: no tienen SKU, así que no
// aparecen en ningún ranking de productos ni en el stock. Acá se ven una por
// una, con quién la vendió y en qué sucursal.

type FilaParticular = {
  id: string;
  descripcion: string | null;
  cantidad: number;
  precio_unitario: number;
  venta: {
    fecha: string;
    estado: string;
    sucursal: { nombre: string } | null;
    usuario: { nombre: string } | null;
  } | null;
};

const formatoFecha = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ReporteParticularesPage() {
  const supabase = await createClient();

  const { data: filasRaw } = await supabase
    .from("venta_items")
    .select(
      `id, descripcion, cantidad, precio_unitario,
       venta:ventas ( fecha, estado, sucursal:sucursales ( nombre ), usuario:usuarios ( nombre ) )`,
    )
    .is("sku_id", null)
    .limit(500);

  // Una venta anulada no se cobró: no tiene que sumar en los totales.
  const filas = ((filasRaw ?? []) as unknown as FilaParticular[])
    .filter((f) => f.venta?.estado === "confirmada")
    .sort((a, b) => (b.venta?.fecha ?? "").localeCompare(a.venta?.fecha ?? ""));

  const totalGeneral = filas.reduce((acc, f) => acc + f.precio_unitario * f.cantidad, 0);

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const delMes = filas.filter((f) => f.venta && new Date(f.venta.fecha) >= inicioMes);
  const totalMes = delMes.reduce((acc, f) => acc + f.precio_unitario * f.cantidad, 0);

  // Por sucursal, para ver si es algo de una sola o de las dos.
  const porSucursal = new Map<string, number>();
  for (const f of filas) {
    const nombre = f.venta?.sucursal?.nombre ?? "—";
    porSucursal.set(nombre, (porSucursal.get(nombre) ?? 0) + f.precio_unitario * f.cantidad);
  }

  return (
    <div>
      <SectionHeader
        title="Productos particulares vendidos"
        meta="Lo que se cobró sin estar en el catálogo: picadas, canastas, mixtos"
      />

      <KpiGrid>
        <Kpi
          label="Vendido este mes"
          value={formatoMoneda.format(totalMes)}
          sub={`${delMes.length} ${delMes.length === 1 ? "venta" : "ventas"}`}
        />
        <Kpi
          label="Total acumulado"
          value={formatoMoneda.format(totalGeneral)}
          sub={`${filas.length} ${filas.length === 1 ? "venta" : "ventas"} · últimas 500`}
        />
        {[...porSucursal.entries()].map(([nombre, total]) => (
          <Kpi key={nombre} label={nombre} value={formatoMoneda.format(total)} sub="Acumulado" />
        ))}
      </KpiGrid>

      <div className="mt-3">
        <Card title="Detalle">
          {filas.length === 0 ? (
            <EmptyState
              title="Todavía no se vendió ningún producto particular"
              sub="Aparecen acá apenas se cobre el primero desde el punto de venta."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                      Fecha
                    </th>
                    <th className="border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                      Qué se vendió
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                      Cant.
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                      Precio
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                      Total
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                      Sucursal
                    </th>
                    <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                      Lo vendió
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id} className="border-b border-[#F1F1F3] last:border-b-0">
                      <td className="whitespace-nowrap px-[14px] py-[9px] tabular-nums text-text-2">
                        {f.venta ? formatoFecha.format(new Date(f.venta.fecha)) : "—"}
                      </td>
                      <td className="px-[14px] py-[9px] font-medium text-text">{f.descripcion}</td>
                      <td className="px-[14px] py-[9px] text-right tabular-nums text-text-2">
                        {f.cantidad}
                      </td>
                      <td className="px-[14px] py-[9px] text-right tabular-nums text-text-2">
                        {formatoMoneda.format(f.precio_unitario)}
                      </td>
                      <td className="px-[14px] py-[9px] text-right tabular-nums font-medium text-text">
                        {formatoMoneda.format(f.precio_unitario * f.cantidad)}
                      </td>
                      <td className="whitespace-nowrap px-[14px] py-[9px] text-text-2">
                        {f.venta?.sucursal?.nombre ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-[14px] py-[9px] text-text-2">
                        {f.venta?.usuario?.nombre ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
