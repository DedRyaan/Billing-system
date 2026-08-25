// Field wrapper - UI-SPEC §Field: Caption label above, control, helper
// (ink-muted) or error (danger) caption below; error wires aria-invalid +
// aria-describedby to the control id. Gap label->control sm(8).
import { cloneElement, isValidElement, type ReactElement } from "react";

export interface FieldControlProps {
  id?: string;
  "aria-invalid"?: boolean | undefined;
  "aria-describedby"?: string | undefined;
}

export interface FieldProps {
  id: string;
  label: string;
  helper?: string;
  error?: string;
  children: ReactElement<FieldControlProps>;
}

export function Field({ id, label, helper, error, children }: FieldProps) {
  if (!isValidElement(children)) return null;
  const describedBy = error !== undefined || helper !== undefined ? `${id}-desc` : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-xs block text-caption text-ink-secondary">
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error !== undefined ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {(error !== undefined || helper !== undefined) && (
        <p
          id={`${id}-desc`}
          role={error !== undefined ? "alert" : undefined}
          className={`mt-xs text-caption ${error !== undefined ? "text-danger" : "text-ink-muted"}`}
        >
          {error ?? helper}
        </p>
      )}
    </div>
  );
}
