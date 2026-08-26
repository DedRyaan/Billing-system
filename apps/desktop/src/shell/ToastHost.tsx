// ToastHost - fixed bottom-right stack (24px inset), 360px toasts, <=3,
// white surface + 3px semantic edge, close X + optional action button,
// aria-live=polite region (S9). The ONLY toast renderer in the app.
import { useSyncExternalStore } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import {
  dismissToast,
  getToastSnapshot,
  subscribeToasts,
  type Toast,
} from "./toast-store";

const EDGE_CLASS: Record<Toast["variant"], string> = {
  error: "border-l-[3px] border-l-danger",
  info: "border-l-[3px] border-l-accent",
  success: "border-l-[3px] border-l-success",
};

export function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToastSnapshot);

  return (
    <div
      aria-live="polite"
      data-testid="toast-host"
      className="fixed bottom-6 right-6 z-[60] flex flex-col gap-sm"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.variant === "error" ? "alert" : "status"}
          data-toast-variant={toast.variant}
          // Explicit pointer-events re-enable: Radix modal scroll-lock puts
          // pe:none on <body>, and toasts MUST stay clickable while any
          // sheet/dialog is open.
          style={{ pointerEvents: "auto" }}
          className={`flex w-(--width-toast) items-start gap-sd rounded-md border border-hairline bg-surface p-sd shadow-popover transition-opacity duration-(--duration-base) ${EDGE_CLASS[toast.variant]}`}
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            {toast.variant === "error" && <AlertCircle size={16} className="text-danger" />}
            {toast.variant === "success" && <Check size={16} className="text-success" />}
            {toast.variant === "info" && null}
          </span>
          <p className="min-w-0 flex-1 text-body text-ink">{toast.message}</p>
          {toast.actionLabel !== undefined && (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.();
                dismissToast(toast.id);
              }}
              className="shrink-0 rounded-md px-xs py-0.5 text-body font-semibold text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            type="button"
            aria-label={`Dismiss: ${toast.message}`}
            data-testid={`toast-close-${toast.id}`}
            onClick={() => dismissToast(toast.id)}
            className="shrink-0 rounded-md p-0.5 text-ink-secondary transition-colors duration-(--duration-fast) hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
