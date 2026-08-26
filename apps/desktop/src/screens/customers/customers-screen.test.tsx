// CustomersScreen assembly tests (plan 03-08 Task 3): staff-included
// affordances, state matrix, formatted dates, optimistic rollback.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { CustomersScreen } from "./CustomersScreen";
import { ToastHost } from "../../shell/ToastHost";
import { AuthProvider } from "../../auth/AuthProvider";
import {
  ActiveBusinessProvider,
  type RouterLike,
} from "../../business/ActiveBusinessProvider";

const SESSION = { access_token: "at", refresh_token: "rt" };
const BID = "cccccccc-3333-3333-3333-333333333333";

function customerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

function fixtures(role: string, rows: Array<Record<string, unknown>>): ScriptedClientOptions {
  return {
    session: SESSION,
    profileRow: { id: "user-1", role, is_active: true, locked_at: null, full_name: "Asha Patil", email: "a@e.in" },
    tables: {
      customers: rows,
      profiles: [{ id: "user-1", role, is_active: true, locked_at: null }],
      business_members: [],
    },
  };
}

function mount(client: ReturnType<typeof makeScriptedClient>, opts: { businesses?: unknown[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router: RouterLike = { getCurrentPath: () => "/customers", navigate: vi.fn() };
  return render(
    <AuthProvider authClient={client} authRouter={{ navigate: vi.fn() }}>
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider dataClient={client} router={router}>
          <CustomersScreen />
          <ToastHost />
        </ActiveBusinessProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

// ActiveBusinessProvider resolves the first alphabetical listing row; the
// scripted businesses table drives it. `archived` flags the listing row so
// read-only-context behavior can be exercised.
function withBusinesses(base: ScriptedClientOptions, archived = false): ScriptedClientOptions {
  const businessRow = {
    id: BID,
    legal_name: "Alpha Traders Pvt Ltd",
    trade_name: null,
    gstin: "27AAPFU0939F1ZV",
    number_format: "seq",
    prefix: null,
    address: null,
    state: "27",
    phone: null,
    email: null,
    registration_type: "regular",
    logo_path: null,
    archived_at: archived ? "2026-02-02T00:00:00Z" : null,
    created_at: "",
  };
  return { ...base, tables: { ...base.tables, businesses: [businessRow] } };
}

describe("CustomersScreen", () => {
  it("STAFF sees the Add-customer affordance (D-43 all-roles) and populated rows", async () => {
    const client = makeScriptedClient(withBusinesses(fixtures("staff", [customerRow()])));
    mount(client);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
    expect(screen.getByText("Add customer")).toBeTruthy();
    // State column renders the NAME from STATE_CODES lookup.
    expect(document.querySelector("[data-testid='datatable']")!.textContent).toContain("Maharashtra");
    // Updated column formats en-IN d MMM yyyy.
    expect(document.querySelector("[data-testid='datatable']")!.textContent).toContain("26 Aug 2026");
  });

  it("archived active business hides CTA and rows refuse to open editors", async () => {
    const client = makeScriptedClient(withBusinesses(fixtures("admin", [customerRow()]), true));
    mount(client);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
    expect(screen.queryByText("Add customer")).toBeNull();
    await userEvent.setup().click(screen.getByText("Ravi Kumar"));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("optimistic save failure rolls back + toast Retry reopens preserved edits", async () => {
    const user = userEvent.setup();
    let fail = true;
    const client = makeScriptedClient({
      ...withBusinesses(fixtures("staff", [customerRow()])),
      onWrite: (call) => (fail && call.op === "insert" ? { error: { code: "42501", message: "denied" } } : undefined),
    });
    mount(client);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());

    await user.click(screen.getByText("Add customer"));
    await waitFor(() => expect(document.getElementById("cust-legal-name")).not.toBeNull());
    await user.type(document.getElementById("cust-legal-name") as HTMLInputElement, "New Person");
    await user.selectOptions(document.getElementById("cust-state") as HTMLSelectElement, "27");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);

    await waitFor(() =>
      expect(screen.getByText("Couldn't save customer. Your changes were undone.")).toBeTruthy(),
    );
    // Row count unchanged (rollback) - count DOM rows directly because the
    // open modal aria-hides outside content for accessibility queries.
    expect(document.querySelectorAll("[data-row-id]").length).toBe(1);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.getElementById("cust-legal-name")).not.toBeNull());
    expect((document.getElementById("cust-legal-name") as HTMLInputElement).value).toBe("New Person");
    fail = false;
  });
});