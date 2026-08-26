// ConfirmDialog - centered max-w 420 modal on Radix Dialog (never bare).
// Destructive-focus safety: initial focus lands on CANCEL, never the danger
// button. Esc/scrim = cancel; focus returns to the opener (Radix default).
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title as a question naming the target ("Archive {name}?"). */
  title: string;
  body: string;
  /** Confirm repeats the verb ("Archive business"), never OK/Yes. */
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  cancelLabel = "Cancel",
  tone = "default",
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-[color:var(--color-scrim)]"
          style={{ animationDuration: "var(--duration-base)" }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onOpenChange(false);
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            onOpenChange(false);
          }}
          className="fixed left-1/2 top-1/2 w-(--width-confirm-dialog) max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-surface p-xl shadow-dialog"
        >
          <Dialog.Title className="text-heading text-ink">{title}</Dialog.Title>
          <p className="mt-sm text-body text-ink-secondary">{body}</p>
          <div className="mt-lg flex items-center justify-end gap-sm">
            {/* Initial focus lands here by contract - never the danger button. */}
            <Button
              variant="secondary"
              autoFocus
              data-initial-focus=""
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
