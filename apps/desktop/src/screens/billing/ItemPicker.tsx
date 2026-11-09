// ItemPicker — searchable combobox for catalog item selection (R-42).
//
// Follows the StatePicker pattern: type-to-filter, keyboard navigation.
// Each row shows name + price (₹) + GST rate (%) + stock quantity.
// On select: returns the full CatalogItemRow so the parent can pre-fill
// the line's description, price, HSN/SAC, rate, unit.
// Does NOT allow inline item creation — items are managed in Catalog.
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { parseDecimalToPaise } from "@billing/gst";
import type { CatalogItemRow } from "@billing/api/catalog-items";
import { CONTROL_CLASSES } from "../../components/ui/Input";
import { formatPaise } from "../../lib/format";

export interface ItemPickerProps {
  items: CatalogItemRow[];
  onSelect: (item: CatalogItemRow) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}

/** Format a rupee price string ("1499.50") to display ("₹1,499.50"). */
function formatPrice(numeric: string): string {
  const parsed = parseDecimalToPaise(numeric);
  if (!parsed.ok) return `₹${numeric}`;
  return formatPaise(parsed.paise);
}

export function ItemPicker({
  items,
  onSelect,
  id = "item-picker",
  disabled = false,
  placeholder = "Search catalog item…",
}: ItemPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = items.filter((i) => i.is_active);
    if (q.length === 0) return active;
    return active.filter((i) => i.name.toLowerCase().includes(q));
  }, [query, items]);

  const pick = (item: CatalogItemRow | undefined) => {
    if (!item) return;
    onSelect(item);
    setQuery("");
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
        aria-controls={`${id}-listbox`}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
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
      />
      {open && filtered.length > 0 && (
        <ul
          id={`${id}-listbox`}
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-xs max-h-72 w-full overflow-y-auto rounded-md border border-hairline bg-surface py-xs shadow-popover"
        >
          {filtered.map((item, idx) => (
            <li key={item.id} role="option" aria-selected={idx === highlighted}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                className={`flex w-full items-center justify-between px-sm py-xs text-left text-body ${
                  idx === highlighted ? "bg-accent-subtle text-ink" : "text-ink"
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-caption text-ink-secondary">
                    {formatPrice(String(item.price))} · {item.gst_rate}% · Stock: {item.stock_qty}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length > 0 && filtered.length === 0 && (
        <div className="absolute z-10 mt-xs w-full rounded-md border border-hairline bg-surface px-sm py-xs text-caption text-ink-secondary shadow-popover">
          No matching items
        </div>
      )}
    </div>
  );
}
