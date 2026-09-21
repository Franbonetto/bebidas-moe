"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actualizarUsuario, resetearPasswordUsuario } from "../actions";
import type { SucursalOption, UsuarioRow } from "./usuarios-table";

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";

export function EditarUsuarioForm({
  usuario,
  sucursales,
  onClose,
}: {
  usuario: UsuarioRow;
  sucursales: SucursalOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(usuario.nombre);
  const [activo, setActivo] = useState(usuario.activo);
  const [sucursalIds, setSucursalIds] = useState<string[]>(usuario.sucursalIds);
  const [passwordNueva, setPasswordNueva] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensajePassword, setMensajePassword] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingPassword, startTransitionPassword] = useTransition();

  function toggleSucursal(id: string) {
    setSucursalIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function guardar() {
    if (!nombre.trim()) {
      setError("El nombre no puede quedar vacío.");
      return;
    }
    if (usuario.rol === "encargado" && sucursalIds.length === 0) {
      setError("Elegí al menos una sucursal.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const resultado = await actualizarUsuario({ id: usuario.id, nombre: nombre.trim(), activo, sucursalIds });
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function cambiarPassword() {
    if (passwordNueva.length < 6) {
      setMensajePassword({ tipo: "error", texto: "La contraseña tiene que tener al menos 6 caracteres." });
      return;
    }
    startTransitionPassword(async () => {
      const resultado = await resetearPasswordUsuario(usuario.id, passwordNueva);
      if ("error" in resultado) {
        setMensajePassword({ tipo: "error", texto: resultado.error });
        return;
      }
      setMensajePassword({ tipo: "ok", texto: "Contraseña actualizada." });
      setPasswordNueva("");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-[420px] rounded-card border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-[14px] font-semibold text-text">Editar usuario</h2>
        <p className="mb-4 text-[12px] text-text-3">{usuario.email}</p>

        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClass} />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-text">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Usuario activo (puede loguearse)
          </label>

          {usuario.rol === "encargado" && (
            <div>
              <label className="mb-1 block text-[12px] font-medium text-text-2">Sucursales</label>
              <div className="flex flex-col gap-1">
                {sucursales.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-[13px] text-text">
                    <input
                      type="checkbox"
                      checked={sucursalIds.includes(s.id)}
                      onChange={() => toggleSucursal(s.id)}
                    />
                    {s.nombre}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-[12.5px] text-err">{error}</p>}

          <div className="flex justify-end gap-2 border-b border-border pb-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={pending}
              className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
          </div>

          <div className="pt-1">
            <label className="mb-1 block text-[12px] font-medium text-text-2">Cambiar contraseña</label>
            <div className="flex items-end gap-2">
              <input
                type="text"
                value={passwordNueva}
                onChange={(e) => setPasswordNueva(e.target.value)}
                placeholder="Contraseña nueva"
                className={inputClass}
              />
              <button
                type="button"
                onClick={cambiarPassword}
                disabled={pendingPassword}
                className="shrink-0 rounded-[6px] border border-border bg-bg px-[12px] py-[6px] text-[12.5px] font-medium text-text-2 hover:bg-bg-2 disabled:opacity-60"
              >
                {pendingPassword ? "Cambiando…" : "Cambiar"}
              </button>
            </div>
            {mensajePassword && (
              <p className={`mt-2 text-[12.5px] ${mensajePassword.tipo === "error" ? "text-err" : "text-ok"}`}>
                {mensajePassword.texto}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
