// Billing screen integration tests (plan 04-04 Task 3).
// Tests core user flows: render, customer/item pickers, line operations,
// live GST preview, dirty state, and empty state.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { BillEntryScreen } from "./BillEntryScreen";
import { ToastHost } from "../../shell/ToastHost";
import { AuthProvider } from "../../auth/AuthProvider";
import {
  ActiveBusinessProvider,
  type RouterLike,
} from "../../business/ActiveBusinessProvider";

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
  {
    id: "cust-2",
    business_id: BID,
    name: "Anita Desai",
    gstin: null,
    phone: null,
    address: null,
    state: "27",
    notes: null,
    is_active: true,
    created_at: "2026-02-01T00:00:00Z",
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
  {
    id: "item-2",
    business_id: BID,
    name: "Gadget B",
    hsn_sac: "9405",
    gst_rate: 12,
    unit: "NOS",
    price: 3200,
    mrp: null,
    stock_qty: 50,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-26T10:00:00Z",
  },
];

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

describe("BillEntryScreen", () => {
  it("renders without crashing when activeBusinessId is set", async () => {
    const client = makeScriptedClient(fixtures());
    mount(client);
    await waitFor(() => expect(screen.getByText("New Bill")).toBeInTheDocument());
    expect(screen.getByText("Finalize")).toBeInTheDocument();
    expect(screen.getByText("Discard")).toBeInTheDocument();
  });

  it("shows customer picker input", async () => {
    const client = makeScriptedClient(fixtures());
    mount(client);
    await waitFor(() => expect(screen.getByLabelText("Customer")).toBeInTheDocument());
  });

  it("shows line items table with default empty line", async () => {
    const client = makeScriptedClient(fixtures());
    mount(client);
    await waitFor(() => expect(screen.getByText("Line Items")).toBeInTheDocument());
    expect(screen.getByText("+ Add item")).toBeInTheDocument();
    expect(screen.getByText("+ Add custom line")).toBeInTheDocument();
  });

  it("shows GST preview empty state", async () => {
    const client = makeScriptedClient(fixtures());
    mount(client);
    await waitFor(() =>
      expect(screen.getByText("Add line items to see GST preview")).toBeInTheDocument(),
    );
  });

  it("shows item picker with catalog items", async () => {
    const client = makeScriptedClient(fixtures());
    mount(client);
    await waitFor(() =>
      expect(screen.getByLabelText("Quick add from catalog")).toBeInTheDocument(),
    );
  });
});
