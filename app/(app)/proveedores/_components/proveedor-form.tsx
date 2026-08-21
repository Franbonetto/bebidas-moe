"use client";

import { useState, useTransition } from "react";
import { crearProveedor, actualizarProveedor, type DatosProveedor } from "../actions";
import type { Proveedor } from "./proveedores-table";

const inputClass =
  "w-full rounded-[6px] border border-border bg-bg px-[10px] py-[6px] text-[13px] text-text outline-none focus:border-moe";
const labelClass = "mb-[4px] block text-[12px] font-medium text-text-2";

function vacio(): DatosProveedor {
  return {
    razon_social: "",
    nombre_comercial: "",
    cuit: "",
    contacto: "",
    whatsapp: "",
    email: "",
    direccion: "",
    condicion_pago: "",
    plazo_dias: null,
    observaciones: "",
    activo: true,
  };
}

function aFormulario(proveedor: Proveedor): DatosProveedor {
  return {
    razon_social: proveedor.razon_social,
    nombre_comercial: proveedor.nombre_comercial ?? "",
    cuit: proveedor.cuit ?? "",
    contacto: proveedor.contacto ?? "",
    whatsapp: proveedor.whatsapp ?? "",
    email: proveedor.email ?? "",
    direccion: proveedor.direccion ?? "",
    condicion_pago: proveedor.condicion_pago ?? "",
    plazo_dias: proveedor.plazo_dias,
    observaciones: proveedor.observaciones ?? "",
    activo: proveedor.activo,
  };
}

function aPayload(datos: DatosProveedor): DatosProveedor {
  return {
    ...datos,
    razon_social: datos.razon_social.trim(),
    nombre_comercial: datos.nombre_comercial?.trim() || null,
    cuit: datos.cuit?.trim() || null,
    contacto: datos.contacto?.trim() || null,
    whatsapp: datos.whatsapp?.trim() || null,
    email: datos.email?.trim() || null,
    direccion: datos.direccion?.trim() || null,
    condicion_pago: datos.condicion_pago?.trim() || null,
    observaciones: datos.observaciones?.trim() || null,
  };
}

export function ProveedorForm({
  proveedor,
  onClose,
}: {
  proveedor: Proveedor | null;
  onClose: () => void;
}) {
  const [datos, setDatos] = useState<DatosProveedor>(proveedor ? aFormulario(proveedor) : vacio());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function actualizar<K extends keyof DatosProveedor>(campo: K, valor: DatosProveedor[K]) {
    setDatos((prev) => ({ ...prev, [campo]: valor }));
  }

  function guardar() {
    if (!datos.razon_social.trim()) {
      setError("La razón social es obligatoria.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload = aPayload(datos);
      const resultado = proveedor
        ? await actualizarProveedor(proveedor.id, payload)
        : await crearProveedor(payload);

      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-[480px] overflow-y-auto rounded-card border border-border bg-bg p-5">
        <h2 className="mb-4 text-[14px] font-semibold text-text">
          {proveedor ? "Editar proveedor" : "Nuevo proveedor"}
        </h2>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass}>Razón social *</label>
            <input
              className={inputClass}
              value={datos.razon_social}
              onChange={(e) => actualizar("razon_social", e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass}>Nombre comercial</label>
            <input
              className={inputClass}
              value={datos.nombre_comercial ?? ""}
              onChange={(e) => actualizar("nombre_comercial", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>CUIT</label>
              <input
                className={inputClass}
                value={datos.cuit ?? ""}
                onChange={(e) => actualizar("cuit", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Plazo de pago (días)</label>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={datos.plazo_dias ?? ""}
                onChange={(e) =>
                  actualizar("plazo_dias", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Condición de pago</label>
            <input
              className={inputClass}
              placeholder="Ej: cuenta corriente, contado…"
              value={datos.condicion_pago ?? ""}
              onChange={(e) => actualizar("condicion_pago", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Contacto</label>
              <input
                className={inputClass}
                value={datos.contacto ?? ""}
                onChange={(e) => actualizar("contacto", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>WhatsApp</label>
              <input
                className={inputClass}
                value={datos.whatsapp ?? ""}
                onChange={(e) => actualizar("whatsapp", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              className={inputClass}
              value={datos.email ?? ""}
              onChange={(e) => actualizar("email", e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Dirección</label>
            <input
              className={inputClass}
              value={datos.direccion ?? ""}
              onChange={(e) => actualizar("direccion", e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass}>Observaciones</label>
            <textarea
              className={inputClass}
              rows={2}
              value={datos.observaciones ?? ""}
              onChange={(e) => actualizar("observaciones", e.target.value)}
            />
          </div>

          {proveedor && (
            <label className="flex items-center gap-2 text-[13px] text-text">
              <input
                type="checkbox"
                checked={datos.activo}
                onChange={(e) => actualizar("activo", e.target.checked)}
              />
              Proveedor activo
            </label>
          )}
        </div>

        {error && <p className="mt-3 text-[12.5px] text-err">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-border bg-bg px-[14px] py-[7px] text-[13px] font-medium text-text hover:bg-bg-2"
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
      </div>
    </div>
  );
}
