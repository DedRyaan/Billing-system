// CatalogScreen assembly tests (plan 03-09 Task 3): role-predicated
// affordances, en-IN money rendering, muted inactive rows, staff detail-only.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { CatalogScreen, formatRupees } from "./CatalogScreen";
import { ToastHost } from "../../shell/ToastHost";
import { AuthProvider } from "../../auth/AuthProvider";
import {
  ActiveBusinessProvider,
  type RouterLike,
} from "../../business/ActiveBusinessProvider";

const SESSION = { access_token: "at", refresh_token: "rt" };
const BID = "dddddddd-4444-4444-4444-444444444444";

function itemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "item-1",
    business_id: BID,
    name: "Notebook A4",
    hsn_sac: "482020",
    gst_rate: "18",
    unit: "PCS",
    price: "1499.50",
    mrp: null,
    stock_qty: 0,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-26T10:00:00Z",
    ...overrides,
  };
}

function fixtures(role: string): ScriptedClientOptions {
  return {
    session: SESSION,
    profileRow: { id: "user-1", role, is_active: true, locked_at: null, full_name: "Asha", email: "a@e.in" },
    tables: {
      profiles: [{ id: "user-1", role, is_active: true, locked_at: null }],
      business_members: [],
      catalog_items: [itemRow()],
      businesses: [
        {
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
          archived_at: null,
          created_at: "",
        },
      ],
    },
  };
}

function mount(client: ReturnType<typeof makeScriptedClient>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router: RouterLike = { getCurrentPath: () => "/catalog", navigate: vi.fn() };
  return render(
    <AuthProvider authClient={client} authRouter={{ navigate: vi.fn() }}>
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider dataClient={client} router={router}>
          <CatalogScreen />
          <ToastHost />
        </ActiveBusinessProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe("formatRupees (en-IN grouping)", () => {
  it("groups Indian-style with two decimals", () => {
    expect(formatRupees("1499.5")).toBe("₹1,499.50");
    expect(formatRupees("12345678.9")).toBe("₹1,23,45,678.90");
    expect(formatRupees("0")).toBe("₹0.00");
    expect(formatRupees("junk")).toBe("₹junk"); // graceful passthrough
  });
});

describe("CatalogScreen", () => {
  it("admin sees CTA; rows render rate label via engine round-trip + dash MRP + muted-zero stock", async () => {
    const client = makeScriptedClient(fixtures("admin"));
    mount(client);
    await waitFor(() => expect(screen.getByText("Notebook A4")).toBeTruthy());
    expect(screen.getByText("Add item")).toBeTruthy();
    const table = document.querySelector("[data-testid='datatable']")!;
    expect(table.textContent).toContain("18%"); // bpsToPercentString canonical
    expect(table.textContent).toContain("₹1,499.50");
    expect(table.textContent).toContain("—"); // null MRP
    expect(table.textContent).toContain("PCS");
  });

  it("staff see NO CTA and rows open a detail sheet without Save", async () => {
    const user = userEvent.setup();
    const client = makeScriptedClient(fixtures("staff"));
    mount(client);
    await waitFor(() => expect(screen.getByText("Notebook A4")).toBeTruthy());
    expect(screen.queryByText("Add item")).toBeNull();
    await user.click(screen.getByText("Notebook A4"));
    await waitFor(() => expect(document.getElementById("item-name")).not.toBeNull());
    expect((document.getElementById("item-name") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Read-only — catalog edits are admin-only.")).toBeTruthy();
  });

  it("inactive items stay visible but muted (no filter toggle - documented choice)", async () => {
    const client = makeScriptedClient(fixtures("admin"));
    // Replace listing fixture with an inactive row.
    client.__calls.length = 0;
    const client2 = makeScriptedClient({
      ...fixtures("admin"),
      tables: {
        ...fixtures("admin").tables!,
        catalog_items: [
          itemRow({ id: "item-dead", name: "Discontinued Ink", is_active: false }),
        ],
      },
    });
    void client;
    mount(client2);
    await waitFor(() => expect(screen.getByText("Discontinued Ink")).toBeTruthy());
    const row = document.querySelector("[data-row-id='item-dead']");
    expect(row?.className).toContain("opacity-50");
  });

  it("deactivate confirm flows into an update write carrying is_active=false", async () => {
    const user = userEvent.setup();
    const writes: Array<unknown> = [];
    const base = fixtures("admin");
    const client = makeScriptedClient({
      ...base,
      onWrite: (call) => {
        writes.push(call.payload);
        return undefined;
      },
    });
    mount(client);
    await waitFor(() => expect(screen.getByText("Notebook A4")).toBeTruthy());

    await user.click(screen.getByText("Notebook A4")); // opens edit for admin
    await waitFor(() => expect(document.getElementById("item-name")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate item" }));
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(JSON.stringify(writes[0])).toContain('"is_active":false');
  });
});
