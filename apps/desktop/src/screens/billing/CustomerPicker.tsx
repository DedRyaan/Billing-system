// CustomerPicker — searchable combobox for customer selection (R-41).
//
// Follows the StatePicker pattern: type-to-filter, keyboard navigation,
// onBlur close with 120ms delay. Each row shows name + state + GSTIN for
// place-of-supply context. When no match and query is non-empty, offers
// "Create new customer" to open the CustomerSheet for full entry.
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CONTROL_CLASSES } from "../../components/ui/Input";
import type { CustomerRow } from "@billing/api/customers";

export interface CustomerPickerProps {
  customers: CustomerRow[];
  selected: CustomerRow | null;
  onSelect: (customer: CustomerRow | null) => void;
  onCreateNew: (name: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function CustomerPicker({
  customers,
  selected,
  onSelect,
  onCreateNew,
  id = "customer-picker",
  disabled = false,
  placeholder = "Search customer…",
}: CustomerPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [query, customers]);

  const pick = (customer: CustomerRow | undefined) => {
    if (!customer) return;
    onSelect(customer);
    setQuery(customer.name);
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

  const showCreateOption = query.trim().length > 0 && filtered.length === 0;

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected !== null && query.length === 0 ? selected.name : placeholder}
        value={selected !== null && query.length === 0 ? selected.name : query}
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
      {open && (filtered.length > 0 || showCreateOption) && (
        <ul
          id={`${id}-listbox`}
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-xs max-h-72 w-full overflow-y-auto rounded-md border border-hairline bg-surface py-xs shadow-popover"
        >
          {filtered.map((customer, idx) => (
            <li key={customer.id} role="option" aria-selected={idx === highlighted}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(customer);
                }}
                className={`flex w-full flex-col items-start px-sm py-xs text-left text-body ${
                  idx === highlighted ? "bg-accent-subtle text-ink" : "text-ink"
                }`}
              >
                <span className="font-medium">{customer.name}</span>
                <span className="text-caption text-ink-secondary">
                  {customer.state ?? "—"}
                  {customer.gstin ? ` · ${customer.gstin}` : ""}
                </span>
              </button>
            </li>
          ))}
          {showCreateOption && (
            <li role="option">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onCreateNew(query.trim());
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center px-sm py-xs text-left text-body text-accent"
              >
                + Create customer: "{query.trim()}"
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
