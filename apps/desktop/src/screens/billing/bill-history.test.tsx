// BillHistoryScreen — the All Bills list (issued + voided, newest first).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listBillHistoryPage, type InvoiceRow } from "@billing/api/invoices";
import { BillHistoryScreen } from "./BillHistoryScreen";

vi.mock("@billing/api/invoices", () => ({ listBillHistoryPage: vi.fn() }));
vi.mock("../../auth/AuthProvider", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  const client = { channel: () => channel, removeChannel: () => Promise.resolve("ok") };
  return { useAuth: () => ({ client, profile: { id: "user-1" } }) };
});
vi.mock("../../business/ActiveBusinessProvider", () => ({
  useActiveBusiness: () => ({ activeBusinessId: "biz-1", activeBusiness: null }),
}));

const listMock = vi.mocked(listBillHistoryPage);

function bill(overrides: Partial<InvoiceRow>): InvoiceRow {
  return {
    id: "inv-1",
    business_id: "biz-1",
    fy: "26-27",
    status: "issued",
    seq: 1,
    issued_at: "2026-11-01T10:00:00Z",
    issued_by: "user-1",
    voided_at: null,
    voided_by: null,
    void_reason: null,
    customer_id: null,
    customer_name: "Acme Corp",
    customer_gstin: null,
    customer_address: null,
    supply_type: "intra_state",
    reverse_charge: false,
    registration_type: "regular",
    subtotal_amount: 1000,
    tax_amount: 180,
    total_amount: 1180,
    round_off_amount: 0,
    paid_amount: 0,
    payment_status: "unpaid",
    created_by: "user-1",
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

function mount(props: Partial<{ onOpenBill: (id: string) => void; onNewBill: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenBill = props.onOpenBill ?? vi.fn();
  const onNewBill = props.onNewBill ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <BillHistoryScreen onOpenBill={onOpenBill} onNewBill={onNewBill} />
    </QueryClientProvider>,
  );
  return { onOpenBill, onNewBill };
}

beforeEach(() => {
  listMock.mockReset();
});

describe("BillHistoryScreen", () => {
  it("lists bills with number, buyer, total, due and status", async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: {
        rows: [
          bill({ id: "a", seq: 12, customer_name: "Ravi Kumar", paid_amount: 180, payment_status: "partial" }),
          bill({ id: "b", seq: 11, customer_name: null, paid_amount: 1180, payment_status: "paid" }),
          bill({ id: "c", seq: 10, status: "voided" }),
        ],
        nextCursor: null,
      },
    });
    mount();
    await waitFor(() => expect(screen.getByText("#12")).toBeInTheDocument());
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText("Walk-in customer")).toBeInTheDocument();
    expect(screen.getByText("Due ₹1,000.00")).toBeInTheDocument();
    const list = within(screen.getByRole("list", { name: "Bills" }));
    expect(list.getByText("Partial")).toBeInTheDocument();
    expect(list.getByText("Paid")).toBeInTheDocument();
    expect(list.getByText("Voided")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(expect.anything(), "biz-1", { status: "all", search: "", cursor: null });
  });

  it("opens a bill when its row is clicked", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ ok: true, data: { rows: [bill({ id: "inv-9", seq: 9 })], nextCursor: null } });
    const { onOpenBill } = mount();
    await user.click(await screen.findByText("#9"));
    expect(onOpenBill).toHaveBeenCalledWith("inv-9");
  });

  it("loads the next page with the returned cursor", async () => {
    const user = userEvent.setup();
    const cursor = { issuedAt: "2026-11-01T10:00:00Z", id: "a" };
    listMock
      .mockResolvedValueOnce({ ok: true, data: { rows: [bill({ id: "a", seq: 2 })], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { rows: [bill({ id: "b", seq: 1 })], nextCursor: null } });
    mount();
    await user.click(await screen.findByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getByText("#1")).toBeInTheDocument());
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(listMock).toHaveBeenLastCalledWith(expect.anything(), "biz-1", { status: "all", search: "", cursor });
  });

  it("passes the debounced search text and status filter to the API", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ ok: true, data: { rows: [], nextCursor: null } });
    mount();
    await screen.findByText("No bills yet");
    await user.type(screen.getByRole("searchbox", { name: "Search bills" }), "ravi");
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.anything(), "biz-1", { status: "all", search: "ravi", cursor: null }),
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Bill status" }), "voided");
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.anything(), "biz-1", { status: "voided", search: "ravi", cursor: null }),
    );
    expect(await screen.findByText("No matching bills")).toBeInTheDocument();
  });

  it("shows the first-bill empty state with a New bill CTA", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ ok: true, data: { rows: [], nextCursor: null } });
    const { onNewBill } = mount();
    await screen.findByText("No bills yet");
    const ctas = screen.getAllByRole("button", { name: "New bill" });
    await user.click(ctas[ctas.length - 1]!);
    expect(onNewBill).toHaveBeenCalled();
  });

  it("shows a retryable error instead of an empty list when the read fails", async () => {
    listMock.mockResolvedValue({ ok: false, error: { reason: "NETWORK", message: "offline" } });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load bills.");
    expect(screen.queryByText("No bills yet")).not.toBeInTheDocument();
  });
});
