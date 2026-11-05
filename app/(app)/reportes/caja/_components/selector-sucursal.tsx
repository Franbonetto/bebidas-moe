import Link from "next/link";

// Pestañas Olavarría / Laprida para no mezclar las dos sucursales en el
// mismo reporte (pedido del usuario 2026-11-05). Viaja en la URL
// (?sucursal=<id>) para poder compartir el link de una sucursal puntual,
// igual que período y día.
export function SelectorSucursal({
  base,
  sucursales,
  actual,
  queryExtra,
}: {
  base: string;
  sucursales: { id: string; nombre: string }[];
  actual: string;
  // El resto de la URL a conservar (periodo=mes o dia=2026-11-05), sin el
  // "&" inicial. Vacío si no hay nada que conservar.
  queryExtra: string;
}) {
  return (
    <div className="flex gap-2">
      {sucursales.map((s) => (
        <Link
          key={s.id}
          href={`${base}?sucursal=${s.id}${queryExtra ? `&${queryExtra}` : ""}`}
          className={`rounded-[6px] border px-[10px] py-[4px] text-[12px] font-medium ${
            s.id === actual
              ? "border-moe bg-moe-soft text-moe"
              : "border-border bg-bg text-text-2 hover:bg-bg-2"
          }`}
        >
          {s.nombre}
        </Link>
      ))}
    </div>
  );
}
