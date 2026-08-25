import { TriangleAlert } from "lucide-react";
// CapsLockIndicator contract (UI-SPEC §Component Contracts): appears only
// when the modifier state is true; warning icon + exact caption copy.
const CAPS_LOCK_COPY = "Caps Lock is on";

export function CapsLockHint({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <p
      data-tone="warning"
      className="mt-xs flex items-center gap-xs text-caption text-warning"
      role="note"
    >
      <TriangleAlert size={12} aria-hidden="true" />
      {CAPS_LOCK_COPY}
    </p>
  );
}
