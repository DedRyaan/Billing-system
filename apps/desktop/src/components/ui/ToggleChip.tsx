// ToggleChip - h28 pill; off=white+hairline-strong+Plus, on=accent-subtle+
// accent border+Check. role=switch with aria-checked; Space/Enter toggles
// natively as a button. Used by the membership grid.
export function ToggleChip({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`inline-flex h-(--control-sm) items-center gap-xs rounded-(--radius-pill) border px-sm text-caption transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
        on
          ? "border-accent bg-accent-subtle text-ink"
          : "border-hairline-strong bg-surface text-ink-secondary hover:bg-paper"
      }`}
    >
      <span aria-hidden="true" className="font-semibold">
        {on ? "✓" : "+"}
      </span>
      {label}
    </button>
  );
}
