"use client";

import { useState } from "react";
import { formatoFechaHora } from "../../compras/_lib/formato";
import { NuevoUsuarioForm } from "./nuevo-usuario-form";
import { EditarUsuarioForm } from "./editar-usuario-form";

export type UsuarioRow = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  sucursalIds: string[];
  ultimaVenta: string | null;
};

export type SucursalOption = { id: string; nombre: string };

const ROL_LABEL: Record<string, string> = {
  dueno: "Dueño",
  encargado: "Encargado",
};

export function UsuariosTable({
  usuarios,
  sucursales,
}: {
  usuarios: UsuarioRow[];
  sucursales: SucursalOption[];
}) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<UsuarioRow | null>(null);

  const nombreSucursal = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "?";

  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="text-[13.5px] font-semibold text-text">Usuarios</h2>
          <p className="text-[12px] text-text-3">Quién puede entrar al sistema y desde qué sucursal.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90"
        >
          + Nuevo usuario
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11.5px] uppercase text-text-3">
              <th className="px-4 py-2 font-medium">Nombre</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Rol</th>
              <th className="px-4 py-2 font-medium">Sucursales</th>
              <th className="px-4 py-2 font-medium">Última venta</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-b border-[#F1F1F3] last:border-b-0">
                <td className="px-4 py-[10px] font-medium text-text">{u.nombre}</td>
                <td className="px-4 py-[10px] text-text-2">{u.email}</td>
                <td className="px-4 py-[10px]">
                  <span className="rounded-[5px] bg-moe-soft px-[8px] py-[2px] text-[12px] font-medium text-moe">
                    {ROL_LABEL[u.rol] ?? u.rol}
                  </span>
                </td>
                <td className="px-4 py-[10px] text-text-2">
                  {u.rol === "dueno" ? "Todas" : u.sucursalIds.map(nombreSucursal).join(", ") || "—"}
                </td>
                <td className="px-4 py-[10px] text-text-3">
                  {u.ultimaVenta ? formatoFechaHora.format(new Date(u.ultimaVenta)) : "—"}
                </td>
                <td className="px-4 py-[10px]">
                  <span
                    className={`rounded-[5px] px-[8px] py-[2px] text-[12px] font-medium ${
                      u.activo ? "bg-ok-bg text-ok" : "bg-[#F1F1F3] text-text-3"
                    }`}
                  >
                    {u.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-4 py-[10px] text-right">
                  <button
                    type="button"
                    onClick={() => setEditando(u)}
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

      {creando && <NuevoUsuarioForm sucursales={sucursales} onClose={() => setCreando(false)} />}
      {editando && (
        <EditarUsuarioForm usuario={editando} sucursales={sucursales} onClose={() => setEditando(null)} />
      )}
    </div>
  );
}
