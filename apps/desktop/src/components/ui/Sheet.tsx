// Sheet - the slide-over CRUD editor (UI-SPEC §Sheet). Radix Dialog core +
// `motion` slide (the ONLY motion usage in the kit, D-69): enter 260ms
// cubic-bezier(0.32,0.72,0,1); exit cuts via Radix unmount (headless-safe).
//
// Dirty-discard contract is STRUCTURAL: Esc/scrim with unsaved edits raises
// the Discard-changes confirm ("Keep editing" / "Discard"); a clean close is
// immediate; Radix restores focus to the invoker and scroll-locks the body;
// Enter submits the contained form; initial focus lands on the first field.
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { CANCEL, SAVE } from "../../lib/strings/global";

export interface SheetProps {
  open: boolean;
  /** Invoked on FINAL close - after discard confirm when dirty. */
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  dirty: boolean;
  onSave?: () => void | undefined;
  children: React.ReactNode;
  /** Read-only mirror mode: footer hidden entirely (detail view, D-75-style). */
  readOnly?: boolean | undefined;
  /** Quiet destructive slot rendered at the footer's LEFT edge. */
  footerLeft?: React.ReactNode | undefined;
  /** Disables the Save button while the form is invalid/in-flight. */
  saveDisabled?: boolean | undefined;
}

export function Sheet({ open, onClose, title, subtitle, dirty, onSave, children, readOnly = false, footerLeft, saveDisabled = false }: SheetProps) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const requestClose = () => {
    if (dirty) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  };

  // Contract: initial focus lands on the FIRST INPUT, not the close button.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("input, textarea, select")
        ?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {open && (
            <>
              {/* Scrim click routes through the same dirty guard as Esc. */}
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  key="sheet-scrim"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  onClick={requestClose}
                  className="fixed inset-0 bg-[color:var(--color-scrim)]"
                  style={{ zIndex: 40 }}
                />
              </Dialog.Overlay>

              <Dialog.Content
                asChild
                forceMount
                aria-describedby={undefined}
                onInteractOutside={(e) => {
                  e.preventDefault(); // scrim click handled by Overlay above
                }}
              >
                <motion.div
                  key="sheet-panel"
                  ref={panelRef}
                  data-testid="sheet-panel"
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
                  className="fixed inset-y-0 right-0 flex w-(--width-sheet) max-w-full flex-col overflow-hidden rounded-l-xl bg-surface"
                  style={{ boxShadow: "var(--shadow-sheet)", zIndex: 50 }}
                  onKeyDown={(e) => {
                    // Enter submits the contained form.
                    if (
                      e.key === "Enter" &&
                      !(e.target instanceof HTMLTextAreaElement) &&
                      e.currentTarget.contains(e.target as Node)
                    ) {
                      const form = e.currentTarget.querySelector("form");
                      if (form !== null && (e.target as HTMLElement).tagName !== "BUTTON") {
                        e.preventDefault();
                        form.requestSubmit();
                      }
                    }
                  }}
                >
                  <div
                    key="sheet-header"
                    className="flex h-16 shrink-0 items-start justify-between border-b border-hairline px-lg py-md"
                  >
                    <div>
                      <Dialog.Title className="text-heading text-ink">{title}</Dialog.Title>
                      {subtitle !== undefined && (
                        <p className="text-caption text-ink-secondary">{subtitle}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="close"
                      onClick={requestClose}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onSave?.();
                    }}
                    className="flex min-h-0 flex-1 flex-col"
                  >
                    <div className="min-h-0 flex-1 overflow-y-auto p-lg">{children}</div>
                    {!readOnly && (
                      <footer className="flex shrink-0 items-center gap-sm border-t border-hairline bg-surface p-md">
                        <div className="mr-auto">{footerLeft}</div>
                        <Button type="button" variant="secondary" onClick={requestClose}>
                          {CANCEL}
                        </Button>
                        <Button type="submit" disabled={saveDisabled}>
                          {SAVE}
                        </Button>
                      </footer>
                    )}
                  </form>
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>

      {/* Dirty-discard confirm sits ABOVE the sheet layer. */}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard changes?"
        body="Your edits haven't been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </Dialog.Root>
  );
}
