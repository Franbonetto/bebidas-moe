"use client";

import Image from "next/image";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-2 px-4">
      <form
        action={formAction}
        className="w-full max-w-[360px] rounded-card border border-border bg-bg p-8"
      >
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image src="/logo-moe.png" alt="Bebidas Moe" width={64} height={64} className="h-16 w-16" priority />
          <h1 className="text-[16px] font-semibold text-text">Bebidas Moe</h1>
          <p className="text-[13px] text-text-2">Sistema interno</p>
        </div>

        <label className="mb-1 block text-[12.5px] font-medium text-text-2" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="mb-4 w-full rounded-[6px] border border-border-strong px-3 py-2 text-[13.5px] text-text outline-none focus:border-moe"
        />

        <label className="mb-1 block text-[12.5px] font-medium text-text-2" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mb-5 w-full rounded-[6px] border border-border-strong px-3 py-2 text-[13.5px] text-text outline-none focus:border-moe"
        />

        {error && (
          <div className="mb-4 rounded-[6px] bg-err-bg px-3 py-2 text-[12.5px] text-err">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-[6px] bg-moe px-3 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-[#A81A15] disabled:opacity-60"
        >
          {pending ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
