"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearUsuario } from "../actions";
import type { SucursalOption } from "./usuarios-table";

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";

export function NuevoUsuarioForm({
  sucursales,
  onClose,
}: {
  sucursales: SucursalOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<"dueno" | "encargado">("encargado");
  const [sucursalIds, setSucursalIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleSucursal(id: string) {
    setSucursalIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function crear() {
    if (!nombre.trim() || !email.trim() || password.length < 6) {
      setError("Completá nombre, email y una contraseña de al menos 6 caracteres.");
      return;
    }
    if (rol === "encargado" && sucursalIds.length === 0) {
      setError("Elegí al menos una sucursal para este usuario.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const resultado = await crearUsuario({ nombre: nombre.trim(), email: email.trim(), password, rol, sucursalIds });
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-[420px] rounded-card border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[14px] font-semibold text-text">Nuevo usuario</h2>

        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="ej. gabi@bebidasmoe.local"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Contraseña inicial</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-text-2">Rol</label>
            <div className="flex gap-2">
              {(["encargado", "dueno"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRol(r)}
                  className={`rounded-[6px] border px-[14px] py-[6px] text-[13px] font-medium ${
                    rol === r ? "border-moe bg-moe-soft text-moe" : "border-border bg-bg text-text-2 hover:bg-bg-2"
                  }`}
                >
                  {r === "encargado" ? "Encargado / Empleado" : "Dueño"}
                </button>
              ))}
            </div>
          </div>

          {rol === "encargado" && (
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

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text-2 hover:bg-bg-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={crear}
              disabled={pending}
              className="rounded-[6px] bg-moe px-[14px] py-[7px] text-[13px] font-medium text-white hover:bg-moe/90 disabled:opacity-60"
            >
              {pending ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
