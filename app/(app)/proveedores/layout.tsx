import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { veCostos } from "@/lib/permisos";

export default async function ProveedoresLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  if (!(await veCostos(supabase))) {
    redirect("/productos");
  }

  return <>{children}</>;
}
