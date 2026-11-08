import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/lib/router";
import { Card } from "./ui/card";

interface MetricCardProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  description?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** Use the shared bordered Card surface instead of an unframed metric. */
  appearance?: "plain" | "card";
  /**
   * BINDER hero stat tile (vonis Patria 8 Nov 2026 09:45 WIB): pastel
   * gradient fill — same in light and dark theme — with dark ink.
   * Only used by BinderHero; unset keeps the current behaviour exactly.
   */
  tone?: "binder-tile-1" | "binder-tile-2" | "binder-tile-3" | "binder-tile-4";
}

const BINDER_TILE_TONES = {
  "binder-tile-1": "bg-binder-tile-1",
  "binder-tile-2": "bg-binder-tile-2",
  "binder-tile-3": "bg-binder-tile-3",
  "binder-tile-4": "bg-binder-tile-4",
} as const;

export function MetricCard({ icon: Icon, value, label, description, to, onClick, appearance = "plain", tone }: MetricCardProps) {
  const isClickable = !!(to || onClick);

  const content = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className={`text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums${tone ? " text-binder-tile-ink" : appearance === "card" ? " text-foreground" : ""}`}>
          {value}
        </p>
        <p className={`text-xs sm:text-sm font-medium mt-1${tone ? " text-binder-tile-ink-2" : " text-muted-foreground"}`}>
          {label}
        </p>
        {description && (
          <div className={`text-xs mt-1.5 hidden sm:block${tone ? " text-binder-tile-ink-2" : " text-muted-foreground/70"}`}>{description}</div>
        )}
      </div>
      <Icon className={`h-4 w-4 shrink-0 mt-1.5${tone ? " text-binder-tile-ink-2/50" : " text-muted-foreground/50"}`} />
    </div>
  );
  const surfaceClassName = `h-full px-4 py-4 sm:px-5 sm:py-5 rounded-lg transition-colors${isClickable ? " hover:bg-accent/50 cursor-pointer" : ""}${tone ? ` ${BINDER_TILE_TONES[tone]} border-transparent` : ""}`;
  const inner = appearance === "card"
    ? <Card elevation="low" className={surfaceClassName}>{content}</Card>
    : <div className={surfaceClassName}>{content}</div>;

  if (to) {
    return (
      <Link to={to} className="no-underline text-inherit h-full" onClick={onClick}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div className="h-full" onClick={onClick}>
        {inner}
      </div>
    );
  }

  return inner;
}
