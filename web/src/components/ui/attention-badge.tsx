import { AlertTriangle, Flame } from "lucide-react";
import type { AttentionLevel } from "@/lib/api/types";
import { cn } from "@/lib/cn";

const CONFIG = {
  critical: { label: "Urgente", icon: Flame, className: "bg-critical text-white" },
  warning: { label: "Atenção", icon: AlertTriangle, className: "bg-warning-soft text-warning ring-1 ring-warning-line" },
} as const;

/** Rótulo com texto + ícone: a cor nunca é o único sinal (daltonismo). */
export const AttentionBadge = ({ level, className }: { level: AttentionLevel; className?: string }) => {
  if (level === "ok") return null;
  const { label, icon: Icon, className: tone } = CONFIG[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tone,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
};
