// VoidDialog — modal for voiding an issued invoice (INV-06).
//
// Admin-only (D-16): button is conditionally rendered in InvoiceDetail.
// Requires a void reason (1-500 chars). Calls voidInvoice() Edge Function
// which atomically transitions to voided + creates a replacement draft with
// the voided invoice's lines pre-populated. The voided number is permanently
// consumed (INV-06).
import { useCallback, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { voidInvoice } from "@billing/api/invoices";
import { keysFor } from "@billing/api/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { TextArea } from "../../components/ui/TextArea";
import { useAuth } from "../../auth/AuthProvider";

export interface VoidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceDocNumber: string;
  businessId: string;
  onVoided: (newDraftId: string) => void;
}

export function VoidDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceDocNumber,
  businessId,
  onVoided,
}: VoidDialogProps) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (auth.client === null || businessId === "" || reason.trim().length === 0) return;

    setSubmitting(true);
    try {
      const result = await voidInvoice(auth.client, invoiceId, businessId, reason.trim());
      if (!result.ok) {
        // Error handled below — close dialog is not called on error
        setSubmitting(false);
        return;
      }

      // Invalidate caches
      await queryClient.invalidateQueries({
        queryKey: keysFor.invoices(businessId),
      });

      onOpenChange(false);
      setReason("");

      if (result.data.new_draft_id) {
        onVoided(result.data.new_draft_id);
      }
    } catch {
      // Error shown via toast in the API module
    } finally {
      setSubmitting(false);
    }
  }, [auth.client, businessId, invoiceId, reason, onOpenChange, onVoided, queryClient]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[color:var(--color-scrim)]" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            if (!submitting) onOpenChange(false);
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
            if (!submitting) onOpenChange(false);
          }}
          className="fixed left-1/2 top-1/2 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-surface p-xl shadow-dialog"
        >
          <Dialog.Title className="text-heading text-ink">
            Void Invoice {invoiceDocNumber}?
          </Dialog.Title>
          <p className="mt-sm text-body text-ink-secondary">
            This action cannot be undone. The invoice number will be permanently consumed.
          </p>
          <div className="mt-md">
            <label htmlFor="void-reason" className="mb-xs block text-caption text-ink-secondary">
              Reason for voiding (required)
            </label>
            <TextArea
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for voiding…"
              maxLength={500}
              rows={3}
              disabled={submitting}
            />
          </div>
          <div className="mt-lg flex items-center justify-end gap-sm">
            <Button
              variant="secondary"
              autoFocus
              data-initial-focus=""
              onClick={() => {
                if (!submitting) {
                  onOpenChange(false);
                  setReason("");
                }
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleSubmit}
              disabled={reason.trim().length === 0 || submitting}
              loading={submitting}
            >
              Void Invoice
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
