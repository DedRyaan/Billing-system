// RadioCardGroup - vertical stack of full-width cards (radio dot + Body 600
// title + Caption consequence). Selected = accent border + accent-subtle wash.
// Arrow keys move selection; each card is a real radio for semantics.
import { useId } from "react";

export interface RadioCardOption {
  value: string;
  title: string;
  consequence?: string;
}

export interface RadioCardGroupProps {
  name: string;
  options: readonly RadioCardOption[];
  value: string;
  onValueChange: (v: string) => void;
}

export function RadioCardGroup({ name, options, value, onValueChange }: RadioCardGroupProps) {
  const baseId = useId();

  return (
    <div role="radiogroup" className="flex flex-col gap-sm">
      {options.map((o, idx) => {
        const selected = o.value === value;
        return (
          // eslint-disable-next-line jsx-a11y/label-has-associated-control
          <label
            key={o.value}
            htmlFor={`${baseId}-${o.value}`}
            data-arrow-target={selected ? "" : undefined}
            tabIndex={selected ? -1 : idx === 0 ? -1 : -1}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const dir = e.key === "ArrowDown" ? 1 : -1;
                const nextIdx = (idx + dir + options.length) % options.length;
                const next = options[nextIdx]!;
                onValueChange(next.value);
                document.getElementById(`${baseId}-${next.value}`)?.focus();
              }
            }}
            className={`flex cursor-pointer items-start gap-sm rounded-md border p-md transition-colors duration-(--duration-fast) ${
              selected
                ? "border-accent bg-accent-subtle"
                : "border-hairline-strong bg-surface hover:bg-paper"
            }`}
          >
            <input
              id={`${baseId}-${o.value}`}
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onValueChange(o.value)}
              className="mt-xs h-(--spacing-sd) w-(--spacing-sd) accent-[var(--color-accent)]"
            />
            <span>
              <span className="block text-body font-semibold text-ink">{o.title}</span>
              {o.consequence !== undefined && (
                <span className="mt-0.5 block text-caption text-ink-secondary">{o.consequence}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
