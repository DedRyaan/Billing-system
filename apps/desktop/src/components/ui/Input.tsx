// Input / TextArea / shared control styling per UI-SPEC contracts.
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const CONTROL_CLASSES =
  "w-full rounded-md border bg-surface px-sm text-body text-ink placeholder:text-ink-muted " +
  "border-hairline-strong focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus:outline-none " +
  "transition-colors duration-(--duration-fast) " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-subtle " +
  "disabled:bg-paper disabled:text-ink-muted read-only:bg-surface read-only:border-dashed";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", ...rest }, ref,
) {
  return <input ref={ref} {...rest} className={`h-(--control-md) ${CONTROL_CLASSES} ${className}`} />;
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className = "", ...rest }, ref,
) {
  return (
    <textarea ref={ref} {...rest} className={`min-h-[72px] py-xs ${CONTROL_CLASSES} ${className}`} />
  );
});
