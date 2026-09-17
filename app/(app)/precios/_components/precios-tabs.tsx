"use client";

import { useState, type ReactNode } from "react";

export function PreciosTabs({
  tabPrecios,
  tabPromociones,
}: {
  tabPrecios: ReactNode;
  tabPromociones: ReactNode | null;
}) {
  const [tab, setTab] = useState<"precios" | "promociones">("precios");

  if (!tabPromociones) return <>{tabPrecios}</>;

  const tabBtnClass = (activo: boolean) =>
    `border-b-2 px-[2px] pb-[8px] text-[13px] font-medium ${
      activo ? "border-moe text-moe" : "border-transparent text-text-2 hover:text-text"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-5 border-b border-border">
        <button type="button" className={tabBtnClass(tab === "precios")} onClick={() => setTab("precios")}>
          Precios
        </button>
        <button type="button" className={tabBtnClass(tab === "promociones")} onClick={() => setTab("promociones")}>
          Promociones
        </button>
      </div>

      <div className={tab === "precios" ? "flex flex-col gap-5" : "hidden"}>{tabPrecios}</div>
      <div className={tab === "promociones" ? "" : "hidden"}>{tabPromociones}</div>
    </div>
  );
}
