// CR-03 regression suite: mutation-failure Retry must NEVER convert an edit
// into a create. On every CRUD screen a failed edit reopens the EDIT sheet
// bound to the same row identity with the entered values, and the retried
// save rides the UPDATE path - never an INSERT duplicate.
//
//   businesses: Retry reopens edit-mode (GSTIN readOnly = create-only lock)
//               with edited values; retry-save records update, zero inserts.
//   customers:  title flips back to "Edit customer"; edited name persists;
//               retry-save records update, zero inserts.
//   catalog:    title "Edit item"; edited price persists (paise round-trip);
//               retry-save records update, zero inserts.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  makeScriptedClient,
} from "../lib/test/fake-client";
import { ToastHost } from "../shell/ToastHost";
import { AuthProvider } from "../auth/AuthProvider";
import {
  ActiveBusinessProvider,
  type RouterLike,
} from "../business/ActiveBusinessProvider";
import { BusinessesScreen } from "./businesses/BusinessesScreen";
import { CustomersScreen } from "./customers/CustomersScreen";
import { CatalogScreen } from "./catalog/CatalogScreen";

const SESSION = { access_token: "at", refresh_token: "rt" };
const PROFILE = (role: string) => ({
  id: "user-1",
  role,
  is_active: true,
  locked_at: null,
  full_name: "Asha",
  email: "a@e.in",
});

const DENY = { error: { code: "42501", message: "denied" } };

function businessRow() {
  return {
    id: "biz-1",
    legal_name: "Alpha Traders Pvt Ltd",
    trade_name: null,
    gstin: "27AAPFU0939F1ZV",
    number_format: "seq",
    prefix: null,
    address: { lines: ["12 MG Road"], city: "Pune", pincode: "411001" },
    state: "27",
    phone: null,
    email: null,
    registration_type: "regular",
    logo_path: null,
    archived_at: null,
    created_at: "",
  };
}

function activeBusinessTable(id: string) {
  return [{ ...businessRow(), id }];
}

function mountWith(
  client: ReturnType<typeof makeScriptedClient>,
  screenEl: React.ReactElement,
  path: string,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router: RouterLike = { getCurrentPath: () => path, navigate: vi.fn() };
  return render(
    <AuthProvider authClient={client} authRouter={{ navigate: vi.fn() }}>
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider dataClient={client} router={router}>
          {screenEl}
          <ToastHost />
        </ActiveBusinessProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

const writeOps = (
  client: ReturnType<typeof makeScriptedClient>,
  table: string,
): string[] =>
  client.__calls
    .filter((c) => c.table === table && ["insert", "update", "delete"].includes(c.op))
    .map((c) => c.op);

describe("CR-03: retry preserves edit identity", () => {
  it("businesses: failed edit retries as THE SAME edit (readOnly GSTIN, values kept, update not insert)", async () => {
    const user = userEvent.setup();
    let failWrites = true;
    const client = makeScriptedClient({
      session: SESSION,
      profileRow: PROFILE("super_admin"),
      tables: {
        profiles: [PROFILE("super_admin")],
        business_members: [],
        businesses: activeBusinessTable("biz-1"),
      },
      onWrite: () => (failWrites ? DENY : undefined),
    });
    mountWith(client, <BusinessesScreen />, "/businesses");

    await waitFor(() => expect(screen.getByText("Alpha Traders Pvt Ltd")).toBeTruthy());
    await user.click(screen.getByText("Alpha Traders Pvt Ltd"));
    await waitFor(() => expect(document.getElementById("biz-trade-name")).not.toBeNull());

    const tradeName = document.getElementById("biz-trade-name") as HTMLInputElement;
    await user.type(tradeName, "Family Mart");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() =>
      expect(screen.getByText("Couldn't save business. Your changes were undone.")).toBeTruthy(),
    );

    // CR-03: retry reopens EDIT mode bound to the row.
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.getElementById("biz-gstin")).not.toBeNull());
    expect(
      (document.getElementById("biz-gstin") as HTMLInputElement).hasAttribute("readonly"),
    ).toBe(true);
    expect((document.getElementById("biz-trade-name") as HTMLInputElement).value).toBe(
      "Family Mart",
    );

    failWrites = false;
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't save business. Your changes were undone.")).toBeNull(),
    );
    const ops = writeOps(client, "businesses");
    expect(ops).not.toContain("insert");
    expect(ops.filter((op) => op === "update").length).toBeGreaterThanOrEqual(2);
  });

  it("customers: failed edit retries as 'Edit customer' with values kept; update not insert", async () => {
    const user = userEvent.setup();
    let failWrites = true;
    const client = makeScriptedClient({
      session: SESSION,
      profileRow: PROFILE("staff"),
      tables: {
        profiles: [PROFILE("staff")],
        business_members: [],
        customers: [
          {
            id: "cust-1",
            business_id: "cccccccc-3333-3333-3333-333333333333",
            name: "Ravi Kumar",
            gstin: null,
            phone: null,
            address: null,
            state: "27",
            notes: null,
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-08-26T10:00:00Z",
          },
        ],
        businesses: [{ ...businessRow(), id: "cccccccc-3333-3333-3333-333333333333" }],
      },
      onWrite: () => (failWrites ? DENY : undefined),
    });
    mountWith(client, <CustomersScreen />, "/customers");

    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
    await user.click(screen.getByText("Ravi Kumar"));
    await waitFor(() => expect(document.getElementById("cust-legal-name")).not.toBeNull());

    const nameInput = document.getElementById("cust-legal-name") as HTMLInputElement;
    await user.type(nameInput, " Junior");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() =>
      expect(screen.getByText("Couldn't save customer. Your changes were undone.")).toBeTruthy(),
    );

    // CR-03: retry reopens THE EDIT sheet (title contract), values intact.
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Edit customer")).toBeInTheDocument();
    expect((document.getElementById("cust-legal-name") as HTMLInputElement).value).toBe(
      "Ravi Kumar Junior",
    );

    failWrites = false;
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't save customer. Your changes were undone.")).toBeNull(),
    );
    const ops = writeOps(client, "customers");
    expect(ops).not.toContain("insert");
    expect(ops.filter((op) => op === "update").length).toBeGreaterThanOrEqual(2);
  });

  it("catalog: failed edit retries as 'Edit item' with paise-exact price kept; update not insert", async () => {
    const user = userEvent.setup();
    let failWrites = true;
    const BID = "dddddddd-4444-4444-4444-444444444444";
    const client = makeScriptedClient({
      session: SESSION,
      profileRow: PROFILE("admin"),
      tables: {
        profiles: [PROFILE("admin")],
        business_members: [],
        catalog_items: [
          {
            id: "item-1",
            business_id: BID,
            name: "Notebook A4",
            hsn_sac: "482020",
            gst_rate: "18",
            unit: "PCS",
            price: "1499.50",
            mrp: null,
            stock_qty: 7,
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-08-26T10:00:00Z",
          },
        ],
        businesses: [{ ...businessRow(), id: BID }],
      },
      onWrite: () => (failWrites ? DENY : undefined),
    });
    mountWith(client, <CatalogScreen />, "/catalog");

    await waitFor(() => expect(screen.getByText("Notebook A4")).toBeTruthy());
    await user.click(screen.getByText("Notebook A4"));
    await waitFor(() => expect(document.getElementById("item-price")).not.toBeNull());

    // Edit price via select-all replace: clear then type new value.
    const price = document.getElementById("item-price") as HTMLInputElement;
    await user.clear(price);
    await user.type(price, "1599.75");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() =>
      expect(screen.getByText("Couldn't save item. Your changes were undone.")).toBeTruthy(),
    );

    // CR-03: retry reopens THE EDIT sheet; edited paise value survived the
    // normalize -> draft -> initial round-trip exactly.
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Edit item")).toBeInTheDocument();
    expect((document.getElementById("item-price") as HTMLInputElement).value).toBe("1599.75");
    expect((document.getElementById("item-stock") as HTMLInputElement).value).toBe("7");

    failWrites = false;
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByText("Couldn't save item. Your changes were undone.")).toBeNull(),
    );
    const ops = writeOps(client, "catalog_items");
    expect(ops).not.toContain("insert");
    expect(ops.filter((op) => op === "update").length).toBeGreaterThanOrEqual(2);
  });
});
