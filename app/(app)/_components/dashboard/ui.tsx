import Link from "next/link";
import type { ReactNode } from "react";

export function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-[10px] flex items-baseline gap-[10px]">
      <h2 className="text-[13px] font-semibold tracking-wide text-text">{title}</h2>
      {meta && <span className="text-[12px] text-text-3">{meta}</span>}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-bg p-[15px]">
      <div className="mb-[5px] text-[12px] font-medium text-text-2">{label}</div>
      <div className="text-[23px] font-semibold tracking-tight tabular-nums text-text">{value}</div>
      {sub && <div className="mt-[5px] text-[12px] text-text-3">{sub}</div>}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex items-center justify-between gap-3 border-b border-border px-[14px] py-[11px]">
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="whitespace-nowrap text-[12.5px] font-medium text-moe hover:underline">
      {children}
    </Link>
  );
}

type DotColor = "err" | "warn" | "orange" | "info" | "ok";

const DOT_CLASS: Record<DotColor, string> = {
  err: "bg-err",
  warn: "bg-warn",
  orange: "bg-orange",
  info: "bg-info",
  ok: "bg-ok",
};

export function AlertRow({
  color,
  title,
  sub,
  right,
  href,
}: {
  color: DotColor;
  title: string;
  sub?: string;
  right?: ReactNode;
  href?: string;
}) {
  const className =
    "flex items-center gap-[11px] rounded-card border border-border bg-bg px-[14px] py-[11px]";
  const content = (
    <>
      <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${DOT_CLASS[color]}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text">{title}</span>
        {sub && <span className="block truncate text-[12px] text-text-3">{sub}</span>}
      </span>
      {right}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${className} hover:bg-[#FAFAFB]`}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}

export function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-[14px] py-[26px] text-center">
      <p className="mb-[3px] text-[13.5px] font-semibold text-text">{title}</p>
      <p className="text-[12.5px] text-text-3">{sub}</p>
    </div>
  );
}

export function PlaceholderCard({ title, nota }: { title: string; nota: string }) {
  return (
    <div className="rounded-card border border-dashed border-border bg-bg-2 px-[14px] py-[14px]">
      <p className="mb-[3px] text-[13px] font-semibold text-text-2">{title}</p>
      <p className="text-[12.5px] text-text-3">{nota}</p>
    </div>
  );
}

// El rojo Moe es acento de marca, no color de dato (docs/identidad-visual.md:
// "no utilizarlo para representar absolutamente todo"). "neutral" es para
// datos sin carga (plata, cantidades) -- gris medio. "loss" es para datos
// que sí son una pérdida (diferencias de inventario) -- el rojo funcional
// de la guía (error/faltante) pero suave, no el rojo de marca a máxima
// intensidad.
const BAR_TONE_CLASS = {
  neutral: "bg-text-2 opacity-60",
  loss: "bg-err opacity-55",
} as const;

export function BarRow({
  label,
  value,
  max,
  display,
  tone = "neutral",
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  tone?: keyof typeof BAR_TONE_CLASS;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[minmax(90px,160px)_1fr_auto] items-center gap-[11px] text-[12.5px]">
      <span className="text-text-2">{label}</span>
      <div className="h-[7px] overflow-hidden rounded-full bg-bg-2">
        <div className={`h-full rounded-full ${BAR_TONE_CLASS[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right tabular-nums text-text-2">{display}</span>
    </div>
  );
}

export function StatRow({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-[14px] py-[10px]">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-text">{label}</p>
        {sub && <p className="truncate text-[11.5px] text-text-3">{sub}</p>}
      </div>
      <p className="shrink-0 text-[14px] font-medium tabular-nums text-text">{value}</p>
    </div>
  );
}

type BadgeColor = "ok" | "warn" | "orange" | "err" | "info" | "mute";

const BADGE_CLASS: Record<BadgeColor, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  orange: "bg-orange-bg text-orange",
  err: "bg-err-bg text-err",
  info: "bg-info-bg text-info",
  mute: "bg-bg-2 text-text-2",
};

export function Badge({ color, children }: { color: BadgeColor; children: ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[5px] px-[7px] py-[2px] text-[11.5px] font-medium ${BADGE_CLASS[color]}`}
    >
      {children}
    </span>
  );
}

export function QuickActions({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-[10px] lg:grid-cols-3">{children}</div>;
}

export function QuickAction({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-[3px] rounded-card border border-border bg-bg p-[14px] hover:border-border-strong hover:bg-[#FAFAFB]"
    >
      <b className="text-[13px] font-medium text-text">{label}</b>
      <small className="text-[12px] text-text-3">{sub}</small>
    </Link>
  );
}
