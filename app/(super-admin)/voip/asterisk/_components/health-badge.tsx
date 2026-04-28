import { cn } from "@/lib/utils";

export type HealthStatus = "online" | "degraded" | "offline" | "unknown";

type HealthBadgeProps = {
  status: HealthStatus;
  detail?: string;
  variant?: "sm" | "lg";
  className?: string;
};

const STATUS_META: Record<
  HealthStatus,
  { label: string; dot: string; ring: string; text: string; bg: string; emoji: string }
> = {
  online: {
    label: "Online",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    emoji: "🟢",
  },
  degraded: {
    label: "Degradado",
    dot: "bg-amber-500",
    ring: "ring-amber-500/30",
    text: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    emoji: "🟡",
  },
  offline: {
    label: "Offline",
    dot: "bg-red-500",
    ring: "ring-red-500/30",
    text: "text-red-700 dark:text-red-300",
    bg: "bg-red-50 dark:bg-red-950/40",
    emoji: "🔴",
  },
  unknown: {
    label: "Desconhecido",
    dot: "bg-slate-400",
    ring: "ring-slate-400/30",
    text: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-50 dark:bg-slate-900/40",
    emoji: "⚪",
  },
};

export function HealthBadge({
  status,
  detail,
  variant = "lg",
  className,
}: HealthBadgeProps) {
  const meta = STATUS_META[status];
  const sizes =
    variant === "lg"
      ? "px-3 py-1.5 text-base"
      : "px-2 py-0.5 text-xs";
  const dotSize = variant === "lg" ? "h-2.5 w-2.5" : "h-1.5 w-1.5";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Status do PBX: ${meta.label}${detail ? `. ${detail}` : ""}`}
      className={cn(
        "inline-flex items-center gap-2 rounded-full ring-1 ring-inset",
        sizes,
        meta.bg,
        meta.ring,
        meta.text,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("inline-block animate-pulse rounded-full", dotSize, meta.dot)}
      />
      <span className="font-medium">{meta.label}</span>
      {detail && variant === "lg" && (
        <span className="text-xs text-muted-foreground">— {detail}</span>
      )}
    </div>
  );
}