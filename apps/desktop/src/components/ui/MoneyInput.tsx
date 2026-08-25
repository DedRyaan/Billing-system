// MoneyInput - rupee adornment inside the left edge; emits RAW strings upward
// (parsing stays the caller's job via parseDecimalToPaise). Right alignment is
// a table-context concern, not this primitive's default.
import { forwardRef, type InputHTMLAttributes } from "react";
import { CONTROL_CLASSES } from "./Input";

export interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (raw: string) => void;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, className = "", ...rest }, ref,
) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-sm flex items-center text-caption text-ink-secondary"
      >
        ₹
      </span>
      <input
        ref={ref}
        {...rest}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={`h-(--control-md) pl-lg ${CONTROL_CLASSES} ${className}`}
      />
    </div>
  );
});
