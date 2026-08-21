"use client";

import { useMemo, useState } from "react";
import { ProveedorForm } from "./proveedor-form";

export type Proveedor = {
  id: string;
  razon_social: string;
  nombre_comercial: string | null;
  cuit: string | null;
  contacto: string | null;
  whatsapp: string | null;
  email: string | null;
  direccion: string | null;
  condicion_pago: string | null;
  plazo_dias: number | null;
  observaciones: string | null;
  activo: boolean;
};

export function ProveedoresTable({ proveedores }: { proveedores: Proveedor[] }) {
  const [query, setQuery] = useState("");
  const [proveedorEnEdicion, setProveedorEnEdicion] = useState<Proveedor | null>(null);
  const [mostrarAlta, setMostrarAlta] = useState(false);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return proveedores;
    return proveedores.filter((p) => {
      return (
        p.razon_social.toLowerCase().includes(q) ||
        (p.nombre_comercial ?? "").toLowerCase().includes(q) ||
        (p.cuit ?? "").toLowerCase().includes(q)
      );
    });
  }, [proveedores, query]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-text">Proveedores</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por razón social, nombre o CUIT…"
            className="w-[240px] rounded-[6px] border border-border bg-bg-2 px-[10px] py-[5px] text-[13px] text-text outline-none focus:border-moe"
          />
          <span className="whitespace-nowrap text-[12px] text-text-3">
            {filtrados.length} de {proveedores.length}
          </span>
          <button
            type="button"
            onClick={() => setMostrarAlta(true)}
            className="whitespace-nowrap rounded-[6px] bg-moe px-[12px] py-[6px] text-[13px] font-medium text-white hover:bg-moe/90"
          >
            Nuevo proveedor
          </button>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="px-[14px] py-[26px] text-center">
          {proveedores.length === 0 ? (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                Todavía no hay proveedores
              </p>
              <p className="text-[12.5px] text-text-3">
                Agregá el primer proveedor para comenzar a registrar compras.
              </p>
            </>
          ) : (
            <>
              <p className="mb-[3px] text-[13.5px] font-semibold text-text">
                No encontramos proveedores
              </p>
              <p className="text-[12.5px] text-text-3">Probá con otra razón social, nombre o CUIT.</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Proveedor
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  CUIT
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Contacto
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Condición de pago
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-left text-[11.5px] font-medium tracking-wide text-text-2">
                  Estado
                </th>
                <th className="whitespace-nowrap border-b border-border bg-bg-2 px-[14px] py-[7px] text-right text-[11.5px] font-medium tracking-wide text-text-2">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-[#F1F1F3] last:border-b-0 hover:bg-[#FAFAFB]"
                >
                  <td className="px-[14px] py-[9px] align-middle">
                    <p className="font-medium text-text">{p.razon_social}</p>
                    {p.nombre_comercial && (
                      <p className="text-[11.5px] text-text-3">{p.nombre_comercial}</p>
                    )}
                  </td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">{p.cuit ?? "—"}</td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">
                    {p.contacto ?? p.whatsapp ?? p.email ?? "—"}
                  </td>
                  <td className="px-[14px] py-[9px] align-middle text-text-2">
                    {p.condicion_pago ?? "—"}
                    {p.plazo_dias != null && p.condicion_pago ? ` · ${p.plazo_dias} días` : ""}
                  </td>
                  <td className="px-[14px] py-[9px] align-middle">
                    <span
                      className={`inline-block rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-medium ${
                        p.activo ? "bg-ok-bg text-ok" : "bg-bg-2 text-text-3"
                      }`}
                    >
                      {p.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-[14px] py-[9px] text-right align-middle">
                    <button
                      type="button"
                      onClick={() => setProveedorEnEdicion(p)}
                      className="text-[12.5px] font-medium text-moe hover:underline"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mostrarAlta && (
        <ProveedorForm proveedor={null} onClose={() => setMostrarAlta(false)} />
      )}
      {proveedorEnEdicion && (
        <ProveedorForm
          proveedor={proveedorEnEdicion}
          onClose={() => setProveedorEnEdicion(null)}
        />
      )}
    </div>
  );
}
