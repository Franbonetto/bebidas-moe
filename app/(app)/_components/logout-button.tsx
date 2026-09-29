"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="mt-1 w-full rounded-[6px] px-2 py-[7px] text-left text-[12.5px] font-medium text-moe hover:bg-moe-soft"
    >
      Cerrar sesión
    </button>
  );
}
