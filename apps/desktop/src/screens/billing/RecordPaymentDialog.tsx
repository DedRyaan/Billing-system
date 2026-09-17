// RecordPaymentDialog — modal for recording a payment against an issued
// invoice (PAY-01). Mirrors VoidDialog's Radix Dialog + cache invalidation
// pattern exactly.
//
// Locked decisions:
//   T-05-07   operation_id generated once per opening and retained across retries
//   T-05-06   MoneyInput + parseFloat pre-validation; DB trigger as backstop
//   T-05-05   recorded_by set from auth.profile.id (server-verified)
//   PAY-01    recordPayment via @billing/api/payments (direct RLS insert)
//   D-79      single-door: all payment access through payments module
//
// DB stores amounts as numeric(14,2) in rupees. MoneyInput captures a
// rupee string; parseFloat converts to the number passed to recordPayment.
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { recordPayment } from "@billing/api/payments";
import { keysFor } from "@billing/api/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { serializePaise } from "@billing/gst";
import { Button } from "../../components/ui/Button";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { RadioCardGroup, type RadioCardOption } from "../../components/ui/RadioCardGroup";
import { TextArea } from "../../components/ui/TextArea";
import { useAuth } from "../../auth/AuthProvider";
import { showToast, showMutationFailure } from "../../shell/toast-store";

const PAYMENT_METHODS: readonly RadioCardOption[] = [
  { value: "cash", title: "Cash", consequence: "Physical cash received" },
  { value: "upi", title: "UPI", consequence: "PhonePe / GPay / Paytm" },
  { value: "bank_transfer", title: "Bank Transfer", consequence: "NEFT / RTGS / IMPS" },
  { value: "other", title: "Other", consequence: "Cheque, demand draft, etc." },
] as const;

function fmtPaise(amount: number): string {
  const paise = BigInt(Math.round(amount * 100));
  return `₹${serializePaise(paise)}`;
}

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceDocNumber: string;
  businessId: string;
  /** Balance in rupees (total_amount − paid_amount, both numeric(14,2)). */
  balance: number;
  paymentStatus: string;
  invoiceStatus?: "draft" | "issued" | "voided";
  onRecorded?: (invoiceId: string) => Promise<void>;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceDocNumber,
  businessId,
  balance,
  invoiceStatus,
  onRecorded,
}: RecordPaymentDialogProps) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const operationIdRef = useRef("");
  const pendingInputRef = useRef<Parameters<typeof recordPayment>[1] | null>(null);
  useEffect(() => {
    operationIdRef.current = open ? crypto.randomUUID() : "";
    pendingInputRef.current = null;
    setAmount("");
    setMethod("cash");
    setNote("");
  }, [open, invoiceId, businessId]);

  // Ref to latest handleSubmit so showMutationFailure retry calls the
  // current closure without stale-capture issues.
  const latestSubmitRef = useRef<() => void>(() => {});

  const handleSubmit = useCallback(async () => {
    if (!open || submitting || auth.client === null || businessId === "" || amount === "") return;

    if (invoiceStatus !== undefined && invoiceStatus !== "issued") {
      showToast({ variant: "error", message: "Unable to record payment. Check invoice details and try again." });
      return;
    }

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      showToast({ variant: "error", message: "Enter a valid amount" });
      return;
    }

    setSubmitting(true);
    try {
      // Preserve the logical operation AND payload after an ambiguous failure.
      pendingInputRef.current ??= {
        invoiceId,
        businessId,
        amount: parsed,
        method,
        note: note.trim() || null,
        operationId: operationIdRef.current,
        recordedBy: auth.profile?.id ?? "",
      };
      const result = await recordPayment(auth.client, pendingInputRef.current);

      if (!result.ok) {
        if (result.error.reason === "VALIDATION_FAILED") {
          // Surfaces "payment exceeds invoice balance" (P0001) or
          // "must be greater than zero" (pre-validation).
          pendingInputRef.current = null; // Definitive rejection: allow correction.
          showToast({ variant: "error", message: result.error.message });
        } else {
          showMutationFailure("payment", () => latestSubmitRef.current());
        }
        // Do NOT close dialog on error — user can fix and retry.
        setSubmitting(false);
        return;
      }

      // Invalidate caches — fetches trigger-maintained paid_amount/payment_status.
      await queryClient.invalidateQueries({
        queryKey: keysFor.invoices(businessId),
      });
      await queryClient.invalidateQueries({
        queryKey: keysFor.payments(businessId, invoiceId),
      });

      await queryClient.invalidateQueries({ queryKey: keysFor.outstandings(businessId) });
      await onRecorded?.(invoiceId);

      showToast({ variant: "success", message: "Payment recorded" });
      onOpenChange(false);
      setAmount("");
      setMethod("cash");
      setNote("");
    } catch {
      showMutationFailure("payment", () => latestSubmitRef.current());
    } finally {
      setSubmitting(false);
    }
  }, [open, submitting, auth.client, auth.profile?.id, businessId, amount, invoiceId, invoiceStatus, method, note, onOpenChange, onRecorded, queryClient]);

  // Keep ref current so retry always calls latest handleSubmit.
  latestSubmitRef.current = () => {
    void handleSubmit();
  };

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
            Record Payment — Invoice {invoiceDocNumber}
          </Dialog.Title>
          <p className="mt-sm text-body text-ink-secondary">
            Balance: {fmtPaise(balance)}
          </p>

          <div className="mt-md">
            <label htmlFor="payment-amount" className="mb-xs block text-caption text-ink-secondary">
              Amount (₹)
            </label>
            <MoneyInput
              id="payment-amount"
              value={amount}
              onValueChange={setAmount}
              placeholder="0.00"
              disabled={submitting}
            />
          </div>

          <div className="mt-md">
            <label className="mb-xs block text-caption text-ink-secondary">
              Payment method
            </label>
            <RadioCardGroup
              name="payment-method"
              options={PAYMENT_METHODS}
              value={method}
              onValueChange={setMethod}
              disabled={submitting}
            />
          </div>

          <div className="mt-md">
            <label htmlFor="payment-note" className="mb-xs block text-caption text-ink-secondary">
              Note (optional)
            </label>
            <TextArea
              id="payment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note…"
              maxLength={500}
              rows={2}
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
                  setAmount("");
                  setMethod("cash");
                  setNote("");
                }
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={amount === "" || submitting}
              loading={submitting}
            >
              Record Payment
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
