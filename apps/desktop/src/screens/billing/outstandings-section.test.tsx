// OutstandingsSection tests (Phase 5 verification gaps #20 and #22).
// #20: rows expose issued date, invoice total and paid amount alongside
// balance, age and badge, preserving the API's oldest-first order.
// #22: loading and error states are distinguished from the successful-empty
// "fully paid" state.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listOutstandingInvoices } from "@billing/api/payments";
import type { InvoiceRow } from "@billing/api/invoices";
import { OutstandingsSection } from "./OutstandingsSection";

vi.mock("@billing/api/payments", () => ({ listOutstandingInvoices: vi.fn() }));
vi.mock("../../auth/AuthProvider", () => ({
  useAuth: () => ({ client: {}, profile: { id: "user-1" } }),
}));
vi.mock("../../business/ActiveBusinessProvider", () => ({
  useActiveBusiness: () => ({ activeBusinessId: "biz-1", activeBusiness: null }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const BID = "bbbbbbbb-2222-2222-2222-222222222222";

function invoiceFixture(overrides: Partial<InvoiceRow>): InvoiceRow {
  return {
    id: "inv-1",
    business_id: BID,
    fy: "26-27",
    status: "issued",
    seq: 1,
    issued_at: "2026-08-01T00:00:00Z",
    issued_by: "user-1",
    voided_at: null,
    voided_by: null,
    void_reason: null,
    customer_id: null,
    customer_name: "Acme Corp",
    customer_gstin: null,
    customer_address: null,
    supply_type: null,
    reverse_charge: false,
    registration_type: null,
    subtotal_amount: 1000,
    tax_amount: 180,
    total_amount: 1180,
    round_off_amount: 0,
    paid_amount: 500,
    payment_status: "partial",
    created_by: "user-1",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <OutstandingsSection />
    </QueryClientProvider>,
  );
}

describe("OutstandingsSection rows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows issued date, total and paid alongside balance, age and badge", async () => {
    vi.mocked(listOutstandingInvoices).mockResolvedValue({
      ok: true,
      data: [invoiceFixture({})],
    });
    mount();

    await waitFor(() => expect(screen.getByText(/Acme Corp/)).toBeInTheDocument());
    expect(screen.getByText(/Issued: 1\/8\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Total: ₹1180\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Paid: ₹500\.00/)).toBeInTheDocument();
    expect(screen.getByText(/₹680\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Partial/)).toBeInTheDocument();
  });

  it("renders rows in the oldest-first order returned by the API", async () => {
    vi.mocked(listOutstandingInvoices).mockResolvedValue({
      ok: true,
      data: [
        invoiceFixture({ id: "inv-old", seq: 1, customer_name: "Old Corp", issued_at: "2026-08-01T00:00:00Z" }),
        invoiceFixture({ id: "inv-new", seq: 2, customer_name: "New Corp", issued_at: "2026-09-01T00:00:00Z" }),
      ],
    });
    mount();

    await waitFor(() => expect(screen.getByText(/Old Corp/)).toBeInTheDocument());
    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const oldIdx = rows.findIndex((t) => t.includes("Old Corp"));
    const newIdx = rows.findIndex((t) => t.includes("New Corp"));
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeGreaterThan(oldIdx);
  });
});

describe("OutstandingsSection query states", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows loading copy while the query is pending", async () => {
    vi.mocked(listOutstandingInvoices).mockReturnValue(
      new Promise(() => {}) as never,
    );
    mount();

    expect(screen.getByText(/Loading outstanding dues/i)).toBeInTheDocument();
    expect(screen.queryByText("All invoices are fully paid.")).not.toBeInTheDocument();
  });

  it("shows a retryable error copy instead of the fully-paid empty state", async () => {
    vi.mocked(listOutstandingInvoices).mockResolvedValue({
      ok: false,
      error: { reason: "UNKNOWN", message: "Network failed" },
    } as never);
    mount();

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load outstanding dues/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText("All invoices are fully paid.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows the fully-paid empty state only on a successful empty read", async () => {
    vi.mocked(listOutstandingInvoices).mockResolvedValue({
      ok: true,
      data: [],
    } as never);
    mount();

    await waitFor(() =>
      expect(screen.getByText("All invoices are fully paid.")).toBeInTheDocument(),
    );
  });
});
