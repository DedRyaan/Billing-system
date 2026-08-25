// Button - UI-SPEC §Button contract. Five variants x three sizes; loading
// swaps the leading icon for a 16px inline spinner while the label persists;
// pointer blocked at 40% opacity when disabled. Focus ring lives in CSS.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-text";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-surface border border-hairline-strong text-ink hover:bg-paper",
  ghost: "bg-transparent text-ink-secondary hover:bg-sidebar",
  danger: "bg-danger text-white hover:bg-danger-hover",
  "danger-text": "bg-transparent text-danger hover:bg-danger-subtle",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-(--control-sm) px-sm text-caption",
  md: "h-(--control-md) px-md text-body",
  lg: "h-(--control-lg) px-lg text-body",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, leadingIcon, children, className = "", disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-xs rounded-md font-semibold transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
    >
      {loading ? (
        <LoaderCircle size={16} aria-hidden="true" className="animate-spin" />
      ) : (
        leadingIcon
      )}
      {children}
    </button>
  );
});
