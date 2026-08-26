// WR-01 regression suite: saves are GENUINELY optimistic now. While the
// mutation is IN FLIGHT (write transport hung), the listing cache - and the
// rendered table - already show the edited values. Previously onMutate only
// snapshotted previous data; rows changed only after server round-trip.
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { keysFor } from "@billing/api/query-keys";
import { makeScriptedClient } from "../lib/test/fake-client";
import { CustomersScreen } from "./customers/CustomersScreen";
import { ToastHost } from "../shell/ToastHost";
import { AuthProvider } from "../auth/AuthProvider";
import { ActiveBusinessProvider, type RouterLike } from "../business/ActiveBusinessProvider";

const SESSION = { access_token: "at", refresh_token: "rt" };
const BID = "cccccccc-3333-3333-3333-333333333333";
const LISTING_KEY = keysFor.customers(BID);

/**
 * WR-01 test gate: customer-table UPDATEs never resolve, so any visible row
 * change can ONLY come from the mutation's optimistic projection.
 */
function gateUpdates(client: ReturnType<typeof makeScriptedClient>) {
  const innerFrom = client.from.bind(client);
  type Chain = Record<string, unknown>;
  const never = new Promise<never>(() => {});
  // Terminal chain segment that hangs forever through ANY suffix
  // (.eq()/.select()/.single()/await) so updateCustomer stays pending.
  const hangTerminal: Chain = {
    eq: () => hangTerminal,
    select: () => hangTerminal,
    single: () => never,
    maybeSingle: () => never,
    then: () => undefined,
  };
  (client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const inner = innerFrom(t);
    if (t !== "customers") return inner;
    const wrapped: Chain = Object.create(inner);
    wrapped["update"] = (p: unknown) => {
      (inner as unknown as { update: (p2: unknown) => Chain }).update(p);
      return hangTerminal;
    };
    return wrapped;
  };
}

it("projects the edited row into the cache WHILE the write is in flight (WR-01)", async () => {
  const user = userEvent.setup();
  const client = makeScriptedClient({
    session: SESSION,
    profileRow: { id: "user-1", role: "staff", is_active: true, locked_at: null, full_name: "Asha", email: "a@e.in" },
    tables: {
      profiles: [{ id: "user-1", role: "staff", is_active: true, locked_at: null }],
      business_members: [],
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
      customers: [
        {
          id: "cust-1",
          business_id: BID,
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
    },
  });
  gateUpdates(client);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router: RouterLike = { getCurrentPath: () => "/customers", navigate: vi.fn() };
  render(
    <AuthProvider authClient={client} authRouter={{ navigate: vi.fn() }}>
      <QueryClientProvider client={qc}>
        <ActiveBusinessProvider dataClient={client} router={router}>
          <CustomersScreen />
          <ToastHost />
        </ActiveBusinessProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());

  // Open edit + change the name.
  await user.click(screen.getByText("Ravi Kumar"));
  await waitFor(() => expect(document.getElementById("cust-legal-name")).not.toBeNull());
  const nameInput = document.getElementById("cust-legal-name") as HTMLInputElement;
  await user.type(nameInput, " Prime");
  const save = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
  await user.click(save);

  // THE CONTRACT: while the write hangs, BOTH the cache and the RENDERED
  // TABLE already show the edit. No server round-trip needed.
  await waitFor(() =>
    expect((qc.getQueryData(LISTING_KEY) as Array<{ name: string }>)[0]?.name).toBe(
      "Ravi Kumar Prime",
    ),
  );
  await waitFor(() => expect(screen.getByText("Ravi Kumar Prime")).toBeTruthy());
  // Still exactly ONE row - an update projection, not an append.
  expect((qc.getQueryData(LISTING_KEY) as unknown[]).length).toBe(1);
});
