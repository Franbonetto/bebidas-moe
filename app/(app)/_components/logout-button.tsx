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
      className="mt-1 w-full rounded-[6px] px-2 py-[7px] text-left text-[12.5px] font-medium text-text-2 hover:bg-[#EFEFF1] hover:text-text"
    >
      Cerrar sesión
    </button>
  );
}
