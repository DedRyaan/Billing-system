import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { recordPayment } from "@billing/api/payments";
import { showMutationFailure, showToast } from "../../shell/toast-store";
import { RecordPaymentDialog } from "./RecordPaymentDialog";

vi.mock("@billing/api/payments", () => ({ recordPayment: vi.fn() }));
vi.mock("../../auth/AuthProvider", () => ({
  useAuth: () => ({ client: {}, profile: { id: "user-1" } }),
}));
vi.mock("../../shell/toast-store", () => ({
  showToast: vi.fn(), showMutationFailure: vi.fn(),
}));

const payment = {
  id: "pay-1", invoice_id: "inv-1", business_id: "biz-1", amount: 100,
  method: "cash", note: null, recorded_by: "user-1", operation_id: "op-1",
  created_at: "2026-09-17T00:00:00Z",
};
function Harness() {
  const [open, setOpen] = useState(true);
  return <>
    <button onClick={() => setOpen(true)}>Open payment</button>
    <RecordPaymentDialog open={open} onOpenChange={setOpen} invoiceId="inv-1"
      invoiceDocNumber="#1" businessId="biz-1" balance={200} paymentStatus="unpaid" />
  </>;
}
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);
  return qc;
}
function submit(amount = "100") {
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));
}

describe("RecordPaymentDialog retry lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses the same operation ID and payload after a failed-then-retried submit", async () => {
    vi.mocked(recordPayment).mockResolvedValueOnce({ ok: false, error: {
      reason: "UNKNOWN", message: "Response lost",
    } }).mockResolvedValue({ ok: true, data: payment });
    mount();
    submit();
    await waitFor(() => expect(showMutationFailure).toHaveBeenCalled());
    const first = vi.mocked(recordPayment).mock.calls[0]![1];
    expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/);
    const retry = vi.mocked(showMutationFailure).mock.calls[0]![1];
    await act(async () => { retry(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(recordPayment).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordPayment).mock.calls[1]![1]).toEqual(first);

    fireEvent.click(screen.getByRole("button", { name: "Open payment" }));
    expect(screen.getByLabelText("Amount (₹)")).toHaveValue("");
    submit();
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(3));
    expect(vi.mocked(recordPayment).mock.calls[2]![1].operationId).not.toBe(first.operationId);
  });

  it.each(["draft", "voided"] as const)("blocks submission when status changes to %s while open", async (status) => {
    const qc = new QueryClient();
    const onOpenChange = vi.fn();
    const dialog = (invoiceStatus: "issued" | "draft" | "voided") => (
      <QueryClientProvider client={qc}>
        <RecordPaymentDialog open onOpenChange={onOpenChange} invoiceId="inv-1"
          invoiceDocNumber="#1" businessId="biz-1" balance={200}
          paymentStatus="unpaid" invoiceStatus={invoiceStatus} />
      </QueryClientProvider>
    );
    const view = render(dialog("issued"));
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "100" } });
    view.rerender(dialog(status));
    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));
    expect(recordPayment).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ variant: "error", message: "Unable to record payment. Check invoice details and try again." });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("allows submission with issued status", async () => {
    vi.mocked(recordPayment).mockResolvedValue({ ok: true, data: payment });
    const onOpenChange = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>
      <RecordPaymentDialog open onOpenChange={onOpenChange} invoiceId="inv-1"
        invoiceDocNumber="#1" businessId="biz-1" balance={200}
        paymentStatus="unpaid" invoiceStatus="issued" />
    </QueryClientProvider>);
    submit();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(recordPayment).toHaveBeenCalledTimes(1);
  });

  it("keeps the ID but allows correcting a definitively rejected payment", async () => {
    vi.mocked(recordPayment).mockResolvedValueOnce({ ok: false, error: {
      reason: "VALIDATION_FAILED", message: "Overpayment", pgCode: "P0001",
    } }).mockResolvedValue({ ok: true, data: payment });
    mount();
    submit("300");
    await waitFor(() => expect(screen.getByRole("button", { name: "Record Payment" })).toBeEnabled());
    submit("100");
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(recordPayment).mock.calls;
    expect(calls[1]![1].operationId).toBe(calls[0]![1].operationId);
    expect(calls[1]![1].amount).toBe(100);
  });
});
