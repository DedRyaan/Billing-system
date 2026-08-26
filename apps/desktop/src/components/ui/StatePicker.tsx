// StatePicker - searchable combobox over @billing/gst STATE_CODES (one source
// of truth, D-77). Renders "Name (CODE)" with "(UT)" suffix where isUt;
// includes '97' Other Territory. Keyboard: type-to-filter, arrows, Enter.
// Selection returns the full StateCodeEntry object.
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { STATE_CODES } from "@billing/gst";
import { CONTROL_CLASSES } from "./Input";

export interface StatePickerProps {
  value: (typeof STATE_CODES)[number] | null;
  onPick: (entry: (typeof STATE_CODES)[number]) => void;
  id?: string;
  /** Blocks opening/picking - CONTROL_CLASSES styles it like a disabled Input. */
  disabled?: boolean;
  /** Shown while no selection (ink-muted per the Input placeholder contract). */
  placeholder?: string;
  /** Field injects error wiring; forwarded so invalid/describedby reach the input. */
  "aria-invalid"?: boolean | undefined;
  "aria-describedby"?: string | undefined;
}

function label(entry: (typeof STATE_CODES)[number]): string {
  return `${entry.name} (${entry.code})${entry.isUt ? " (UT)" : ""}`;
}

export function StatePicker({ value, onPick, id, disabled = false, placeholder, ...rest }: StatePickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = STATE_CODES as readonly (typeof STATE_CODES)[number][];
    if (q.length === 0) return all;
    return all.filter(
      (e) => e.name.toLowerCase().includes(q) || e.code.includes(q),
    );
  }, [query]);

  const pick = (entry: (typeof STATE_CODES)[number] | undefined) => {
    if (!entry) return;
    onPick(entry);
    setQuery(label(entry));
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id ?? "state"}-listbox`}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={value !== null && query.length === 0 ? label(value) : query}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={`h-(--control-md) ${CONTROL_CLASSES}`}
        {...rest}
      />
      {open && filtered.length > 0 && (
        <ul
          id={`${id ?? "state"}-listbox`}
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-xs max-h-72 w-full overflow-y-auto rounded-md border border-hairline bg-surface py-xs shadow-popover"
        >
          {filtered.map((entry, idx) => (
            <li key={entry.code} role="option" aria-selected={idx === highlighted}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focus
                  pick(entry);
                }}
                className={`flex w-full items-center justify-between px-sm py-xs text-left text-body ${
                  idx === highlighted ? "bg-accent-subtle text-ink" : "text-ink"
                }`}
              >
                <span>{label(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
