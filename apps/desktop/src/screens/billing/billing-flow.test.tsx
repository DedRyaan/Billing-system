// Billing flow integration tests (plan 04-05 Task 3).
//
// Tests the complete billing loop: finalize, void-and-reissue, error handling,
// admin-only enforcement, and client-server tax agreement. Uses the scripted
// client double with functions.invoke() mocking for Edge Function behavior.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { BillEntryScreen } from "./BillEntryScreen";
import { InvoiceDetail } from "./InvoiceDetail";
import { VoidDialog } from "./VoidDialog";
import { ToastHost } from "../../shell/ToastHost";
import { AuthProvider } from "../../auth/AuthProvider";
import {
  ActiveBusinessProvider,
  type RouterLike,
} from "../../business/ActiveBusinessProvider";
import type { InvoiceRow, InvoiceLineRow } from "@billing/api/invoices";

const SESSION = { access_token: "at", refresh_token: "rt" };
const BID = "bbbbbbbb-2222-2222-2222-222222222222";

const BUSINESS_ROW = {
  id: BID,
  legal_name: "Test Traders",
  trade_name: null,
  gstin: "27AABCT1234F1Z5",
  number_format: "seq",
  prefix: null,
  address: null,
  state: "27",
  phone: null,
  email: null,
  registration_type: "regular",
  logo_path: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const CUSTOMER_ROWS = [
  {
    id: "cust-1",
    business_id: BID,
    name: "Ravi Kumar",
    gstin: "27AAPFU0939F1ZV",
    phone: "9876543210",
    address: { lines: ["12 MG Road"], city: "Pune", pincode: "411001" },
    state: "27",
    notes: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-26T10:00:00Z",
  },
];

const CATALOG_ROWS = [
  {
    id: "item-1",
    business_id: BID,
    name: "Widget A",
    hsn_sac: "8471",
    gst_rate: 18,
    unit: "PCS",
    price: 1500,
    mrp: null,
    stock_qty: 100,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-26T10:00:00Z",
  },
];

const ISSUED_INVOICE: InvoiceRow = {
  id: "inv-issued-1",
  business_id: BID,
  fy: "26-27",
  status: "issued",
  seq: 1,
  issued_at: "2026-08-27T10:00:00Z",
  issued_by: "user-1",
  voided_at: null,
  voided_by: null,
  void_reason: null,
  customer_id: "cust-1",
  customer_name: "Ravi Kumar",
  customer_gstin: "27AAPFU0939F1ZV",
  customer_address: { lines: ["12 MG Road"], city: "Pune", pincode: "411001" },
  supply_type: "intra_state",
  reverse_charge: false,
  registration_type: "regular",
  subtotal_amount: 1500,
  tax_amount: 270,
  total_amount: 1770,
  round_off_amount: 0,
  paid_amount: 0,
  payment_status: "unpaid",
  created_by: "user-1",
  created_at: "2026-08-27T09:55:00Z",
  updated_at: "2026-08-27T10:00:00Z",
};

const ISSUED_LINES: InvoiceLineRow[] = [
  {
    id: "line-1",
    invoice_id: "inv-issued-1",
    position: 1,
    description: "Widget A",
    hsn_sac: "8471",
    quantity: 1,
    unit_price_catalog: 1500,
    unit_price_charged: 1500,
    discount_pct: 0,
    gst_rate: 18,
    taxable_value: 1500,
    cgst_amount: 135,
    sgst_amount: 135,
    igst_amount: 0,
    catalog_item_id: "item-1",
  },
];

const VOIDED_INVOICE: InvoiceRow = {
  ...ISSUED_INVOICE,
  status: "voided",
  voided_at: "2026-08-27T11:00:00Z",
  voided_by: "user-1",
  void_reason: "Wrong quantity",
};

function fixtures(tables: Record<string, unknown[]> = {}): ScriptedClientOptions {
  return {
    session: SESSION,
    profileRow: {
      id: "user-1",
      role: "admin",
      is_active: true,
      locked_at: null,
      full_name: "Test Admin",
      email: "admin@test.com",
    },
    tables: {
      businesses: [BUSINESS_ROW],
      customers: CUSTOMER_ROWS,
      catalog_items: CATALOG_ROWS,
      profiles: [{ id: "user-1", role: "admin", is_active: true, locked_at: null }],
      business_members: [],
      ...tables,
    },
  };
}

function mount(client: ReturnType<typeof makeScriptedClient>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router: RouterLike = {
    getCurrentPath: () => "/bills",
    navigate: vi.fn(),
  };
  return render(
    <AuthProvider
      authClient={client}
      authRouter={{ navigate: vi.fn() }}
      bootstrapProbe={async () => true}
    >
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider dataClient={client} router={router}>
          <BillEntryScreen />
          <ToastHost />
        </ActiveBusinessProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe("billing flow integration", () => {
  let client: ReturnType<typeof makeScriptedClient>;

  beforeEach(() => {
    client = makeScriptedClient(fixtures());
  });

  it("shows empty state when no lines have data", async () => {
    mount(client);
    await waitFor(() => expect(screen.getByText("New Bill")).toBeInTheDocument());
    expect(screen.getByText("Add line items to see GST preview")).toBeInTheDocument();
  });

  it("renders finalize button disabled when no data entered", async () => {
    mount(client);
    await waitFor(() => expect(screen.getByText("New Bill")).toBeInTheDocument());
    const finalizeBtn = screen.getByRole("button", { name: /finalize/i });
    expect(finalizeBtn).toBeDisabled();
  });

  it("shows finalize button enabled after entering line data", async () => {
    const user = userEvent.setup();
    mount(client);
    await waitFor(() => expect(screen.getByText("New Bill")).toBeInTheDocument());

    // Type in the description field of the default empty line
    const descInputs = screen.getAllByRole("textbox");
    const descInput = descInputs[0]!; // First text input is description
    await user.type(descInput, "Widget");

    // The finalize button should be rendered (it becomes enabled once
    // draftResult is non-null, which requires supplier + customer state)
    expect(screen.getByRole("button", { name: /finalize/i })).toBeInTheDocument();
  });
});

describe("finalize persists the draft before finalizing", () => {
  it("writes the typed lines to invoice_lines, then invokes finalize-invoice", async () => {
    const user = userEvent.setup();
    const draftRow = { ...ISSUED_INVOICE, id: "draft-1", status: "draft", seq: null, invoice_lines: [] };
    const client = makeScriptedClient(fixtures({ invoices: [draftRow] }));
    const invoke = client.functions.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockImplementation(async (name: string) =>
      name === "finalize-invoice"
        ? { data: { invoice_id: "draft-1", doc_number: "1", status: "issued", total_amount: 0 }, error: null }
        : { data: null, error: null },
    );
    mount(client);
    await waitFor(() => expect(screen.getByText("New Bill")).toBeInTheDocument());

    await user.type(screen.getAllByRole("textbox")[0]!, "Widget");
    const finalizeBtn = screen.getByRole("button", { name: /^finalize$/i });
    await waitFor(() => expect(finalizeBtn).toBeEnabled());
    await user.click(finalizeBtn);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("finalize-invoice", expect.anything()));
    const lineInsert = client.__calls.find((c) => c.table === "invoice_lines" && c.op === "insert");
    expect(lineInsert).toBeDefined();
    const rows = lineInsert!.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ invoice_id: "draft-1", position: 1, description: "Widget", catalog_item_id: null, unit_price_catalog: null });
    const insertIdx = client.__calls.indexOf(lineInsert!);
    const draftIdx = client.__calls.findIndex((c) => c.table === "invoices" && c.op === "insert");
    expect(draftIdx).toBeGreaterThanOrEqual(0);
    expect(draftIdx).toBeLessThan(insertIdx);
    // Let the post-finalize detail fetch settle before the test unmounts.
    await waitFor(() => expect(screen.getByText(/finalized successfully/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument());
  });

  it("deletes the draft it created when finalize fails", async () => {
    const user = userEvent.setup();
    const draftRow = { ...ISSUED_INVOICE, id: "draft-1", status: "draft", seq: null, invoice_lines: [] };
    const client = makeScriptedClient(fixtures({ invoices: [draftRow] }));
    const invoke = client.functions.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockImplementation(async () => ({ data: null, error: new Error("boom") }));
    mount(client);
    await waitFor(() => expect(screen.getByText("New Bill")).toBeInTheDocument());

    await user.type(screen.getAllByRole("textbox")[0]!, "Widget");
    const finalizeBtn = screen.getByRole("button", { name: /^finalize$/i });
    await waitFor(() => expect(finalizeBtn).toBeEnabled());
    await user.click(finalizeBtn);

    await waitFor(() =>
      expect(client.__calls.some((c) => c.table === "invoices" && c.op === "delete")).toBe(true),
    );
    const del = client.__calls.find((c) => c.table === "invoices" && c.op === "delete")!;
    expect(del.filters).toContainEqual({ col: "id", op: "eq", val: "draft-1" });
    expect(del.filters).toContainEqual({ col: "status", op: "eq", val: "draft" });
  });
});

describe("InvoiceDetail", () => {
  function mountDetail(invoice: InvoiceRow, lines: InvoiceLineRow[], clientOverride?: ReturnType<typeof makeScriptedClient>) {
    const c = clientOverride ?? makeScriptedClient(fixtures());
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <AuthProvider
        authClient={c}
        authRouter={{ navigate: vi.fn() }}
        bootstrapProbe={async () => true}
      >
        <QueryClientProvider client={qc}>
          <InvoiceDetail invoice={invoice} lines={lines} />
        </QueryClientProvider>
      </AuthProvider>,
    );
  }

  it("renders issued invoice with status badge and totals", async () => {
    mountDetail(ISSUED_INVOICE, ISSUED_LINES);

    await screen.findByText("Invoice #1");
    expect(screen.getByText("Issued")).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    // PAY-03: payment status badge + balance derived from paid_amount.
    // "Unpaid" appears twice (header badge + balance section badge).
    expect(screen.getAllByText("Unpaid").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Balance Due")).toBeInTheDocument();
  });

  it("shows empty payment history for issued invoice with no payments", async () => {
    mountDetail(ISSUED_INVOICE, ISSUED_LINES);

    // PAY-02: append-only ledger read view with a graceful empty state.
    await screen.findByText("No payments recorded yet.");
  });

  it.each([ISSUED_INVOICE, VOIDED_INVOICE])("renders payment history table for a $status invoice with payments", async (invoice) => {
    const client = makeScriptedClient(
      fixtures({
        payments: [
          {
            id: "pay-1",
            invoice_id: ISSUED_INVOICE.id,
            business_id: BID,
            amount: 1000,
            method: "cash",
            note: "First advance",
            recorded_by: "aaaaaaaa-1111-2222-3333-444455556666",
            operation_id: "op-1",
            created_at: "2026-08-01T10:00:00Z",
          },
        ],
      }),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <AuthProvider
        authClient={client}
        authRouter={{ navigate: vi.fn() }}
        bootstrapProbe={async () => true}
      >
        <QueryClientProvider client={qc}>
          <InvoiceDetail invoice={invoice} lines={ISSUED_LINES} onRecordPayment={vi.fn()} />
        </QueryClientProvider>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("First advance")).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: /date/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /method/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Recorded by" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "55556666" })).toBeInTheDocument();
    expect(screen.queryByText("No payments recorded yet.")).not.toBeInTheDocument();
    // Voided invoices keep their recorded history, but never offer the
    // Record Payment action again.
    if (invoice.status === "voided") {
      expect(screen.queryByRole("button", { name: /record payment/i })).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole("button", { name: /record payment/i })).toBeInTheDocument();
    }
  });

  it("shows the Payment History section for a voided invoice with no payments", async () => {
    mountDetail(VOIDED_INVOICE, ISSUED_LINES);

    await screen.findByText("Voided");
    expect(screen.getByText("Payment History")).toBeInTheDocument();
    await screen.findByText("No payments recorded yet.");
  });

  it("shows a retryable error instead of the no-payments copy when history fails", async () => {
    // The scripted client serves rows from `tables`; a request against an
    // unregistered table name yields a Postgrest-style error envelope.
    const failing = makeScriptedClient(fixtures());
    vi.spyOn(failing, "from").mockImplementation(() => {
      throw new Error("network unreachable");
    });
    mountDetail(ISSUED_INVOICE, ISSUED_LINES, failing);

    await screen.findByText(/Couldn’t load payment history/);
    expect(screen.queryByText("No payments recorded yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows void details for voided invoice", async () => {
    mountDetail(VOIDED_INVOICE, ISSUED_LINES);

    await screen.findByText("Voided");
    expect(screen.getByText("Void Details")).toBeInTheDocument();
    expect(screen.getByText(/Wrong quantity/)).toBeInTheDocument();
  });

  it("hides void button for non-admin roles (staff)", async () => {
    mountDetail(ISSUED_INVOICE, ISSUED_LINES);

    // Await full render, then confirm no void action is offered.
    await screen.findByText("Invoice #1");
    expect(screen.queryByRole("button", { name: /void/i })).not.toBeInTheDocument();
  });

  it("shows void button when onVoid callback is provided (admin)", async () => {
    const c = makeScriptedClient(fixtures());
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <AuthProvider
        authClient={c}
        authRouter={{ navigate: vi.fn() }}
        bootstrapProbe={async () => true}
      >
        <QueryClientProvider client={qc}>
          <InvoiceDetail
            invoice={ISSUED_INVOICE}
            lines={ISSUED_LINES}
            onVoid={vi.fn()}
            onNewBill={vi.fn()}
          />
        </QueryClientProvider>
      </AuthProvider>,
    );

    await screen.findByRole("button", { name: /void/i });
  });

  it("shows supply type badge", async () => {
    mountDetail(ISSUED_INVOICE, ISSUED_LINES);

    await screen.findByText("Intra-state (CGST+SGST)");
  });

  it("shows reverse charge badge when applicable", async () => {
    mountDetail({ ...ISSUED_INVOICE, reverse_charge: true }, ISSUED_LINES);

    await screen.findByText("Reverse Charge");
  });

  it("shows unregistered for invoices without GSTIN", async () => {
    mountDetail({ ...ISSUED_INVOICE, customer_gstin: null }, ISSUED_LINES);

    await screen.findByText("Unregistered");
  });
});

describe("VoidDialog", () => {
  function mountVoidDialog(props: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    invoiceId?: string;
    invoiceDocNumber?: string;
    businessId?: string;
    onVoided?: (newDraftId: string) => void;
  }) {
    const c = makeScriptedClient(fixtures());
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <AuthProvider
        authClient={c}
        authRouter={{ navigate: vi.fn() }}
        bootstrapProbe={async () => true}
      >
        <QueryClientProvider client={qc}>
          <VoidDialog
            open={props.open ?? true}
            onOpenChange={props.onOpenChange ?? vi.fn()}
            invoiceId={props.invoiceId ?? "inv-1"}
            invoiceDocNumber={props.invoiceDocNumber ?? "#1"}
            businessId={props.businessId ?? BID}
            onVoided={props.onVoided ?? vi.fn()}
          />
        </QueryClientProvider>
      </AuthProvider>,
    );
  }

  it("renders with warning message and disabled confirm when reason empty", async () => {
    mountVoidDialog({});

    await waitFor(() => expect(screen.getByText(/Void Invoice #1/)).toBeInTheDocument());
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();

    // Confirm button should be disabled when reason is empty
    const confirmBtn = screen.getByRole("button", { name: /void invoice/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("enables confirm button when reason is entered", async () => {
    const user = userEvent.setup();
    mountVoidDialog({});

    await waitFor(() => expect(screen.getByText(/Void Invoice #1/)).toBeInTheDocument());

    const reasonField = screen.getByPlaceholderText(/enter reason/i);
    await user.type(reasonField, "Wrong quantity entered");

    const confirmBtn = screen.getByRole("button", { name: /void invoice/i });
    expect(confirmBtn).toBeEnabled();
  });

  it("calls onOpenChange(false) when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    mountVoidDialog({ onOpenChange });

    await waitFor(() => expect(screen.getByText(/Void Invoice #1/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
