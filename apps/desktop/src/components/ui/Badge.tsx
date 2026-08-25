// Badge - pill h20 px-sm Caption 400; semantic subtle-bg pairs from tokens;
// optional 12px leading glyph; NEVER interactive (no button semantics).
import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-paper text-ink-secondary border-hairline",
  accent: "bg-accent-subtle text-accent-hover",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
};

export function Badge({
  tone = "neutral",
  glyph,
  children,
}: {
  tone?: BadgeTone;
  glyph?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-5 items-center gap-xs rounded-(--radius-pill) px-sm text-caption ${TONE_CLASSES[tone]}`}
    >
      {glyph !== undefined && <span aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}
