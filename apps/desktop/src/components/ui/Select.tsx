// Select - native select styled as Input + pointer-events-none ChevronDown.
// Options come ONLY from typed constants via the options prop (no
// children-string API) so slab law / unit lists stay single-sourced upstream.
import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { CONTROL_CLASSES } from "./Input";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (v: string) => void;
  options: readonly SelectOption[];
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { value, onValueChange, options, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        {...rest}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={`h-(--control-md) appearance-none pr-lg ${CONTROL_CLASSES}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-sm top-1/2 -translate-y-1/2 text-ink-secondary"
      />
    </div>
  );
});
