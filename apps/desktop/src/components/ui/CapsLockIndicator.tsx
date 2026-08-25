// CapsLockIndicator - UI-SPEC contract: appears only when modifier state is
// true; warning icon + exact caption copy. The fixed copy lives HERE.
import { TriangleAlert } from "lucide-react";

export const CAPS_LOCK_COPY = "Caps Lock is on";

export function CapsLockIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <p data-tone="warning" className="mt-xs flex items-center gap-xs text-caption text-warning" role="note">
      <TriangleAlert size={12} aria-hidden="true" />
      {CAPS_LOCK_COPY}
    </p>
  );
}
