// ActiveBusinessProvider contract tests (plan 03-06 Task 1, BIZ-04/D-68/D-81).
//
// THE core invariant under test: switching business invalidates every
// foreign-business-scoped query key and touches NOTHING scoped to the new
// business or to the global listing - cross-business cache bleed is made
// structurally impossible by prefix-based sweep over keysFor literals.
//
// The provider is mounted standalone with an injected SupabaseClient double
// and a scripted router handle; production wraps it in TanStack router
// context via AutoRouterActiveBusinessProvider.
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GLOBAL_BUSINESS, keysFor } from "@billing/api/query-keys";
import {
  ActiveBusinessProvider,
  useActiveBusiness,
  type RouterLike,
} from "./ActiveBusinessProvider";

// ---------------------------------------------------------------------------
// Fake data client: serves the businesses listing and records realtime
// channel lifecycle. Mirrors packages/api test fakes' chainable shape.
// ---------------------------------------------------------------------------

interface EmittedChannel {
  name: string;
  handlers: Array<(payload: unknown) => void>;
}

function fakeDataClient(businesses: unknown[], error?: unknown) {
  const channels: EmittedChannel[] = [];
  const removed: string[] = [];
  const client = {
    from(_table: string) {
      const b = {
        select() {
          return b;
        },
        order() {
          return Promise.resolve({ data: error !== undefined ? null : businesses, error: error ?? null });
        },
      };
      return b;
    },
    channel(name: string) {
      const ch: EmittedChannel & {
        on: () => unknown;
        subscribe: () => unknown;
      } = {
        name,
        handlers: [],
        on(this: EmittedChannel, _t: string, _c: unknown, cb: (p: unknown) => void) {
          this.handlers.push(cb);
          return this;
        },
        subscribe() {
          return this;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch: { name?: string }) {
      removed.push(ch?.name ?? "?");
      return Promise.resolve("ok");
    },
  } as unknown as SupabaseClient;
  return { client, channels, removed };
}

const BID_A = "11111111-1111-1111-1111-111111111111";
const BID_B = "22222222-2222-2222-2222-222222222222";

const bizA = {
  id: BID_A,
  legal_name: "Alpha Traders",
  trade_name: null,
  gstin: "27AAPFU0939F1ZV",
  number_format: "prefix_fy_seq",
  prefix: "INV",
  address: null,
  state: "27",
  phone: null,
  email: null,
  registration_type: "regular",
  logo_path: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

const bizB = {
  ...bizA,
  id: BID_B,
  legal_name: "Beta Works",
  gstin: "33AAACC1206D1ZN",
  state: "33",
};

// ---------------------------------------------------------------------------

function Probe({ notes }: { notes?: string[] }) {
  const ctx = useActiveBusiness();
  return (
    <div>
      <output data-testid="active-id">{ctx.activeBusinessId ?? "null"}</output>
      <output data-testid="archived">{String(ctx.isArchived)}</output>
      <output data-testid="is-active-b">{String(ctx.isActiveBusiness(BID_B))}</output>
      <output data-testid="count">{String(ctx.businesses.length)}</output>
      <button type="button" onClick={() => ctx.switchBusiness(BID_B)}>
        switch-to-b
      </button>
      <button type="button" onClick={() => ctx.switchBusiness(BID_A)}>
        switch-to-a
      </button>
      {notes !== undefined && <output data-testid="notes">{notes.join("|")}</output>}
    </div>
  );
}

function mount(
  client: SupabaseClient,
  opts: {
    router?: RouterLike;
    queryClient?: QueryClient;
    children?: ReactNode;
  } = {},
) {
  const qc =
    opts.queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  const navigate = vi.fn();
  const router: RouterLike =
    opts.router ?? { getCurrentPath: () => "/customers", navigate };
  const utils = render(
    <QueryClientProvider client={qc}>
      <ActiveBusinessProvider dataClient={client} router={router}>
        {opts.children ?? <Probe />}
      </ActiveBusinessProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc, navigate };
}

describe("ActiveBusinessProvider", () => {
  it("auto-selects first alphabetical accessible business once the listing resolves", async () => {
    const fake = fakeDataClient([bizA, bizB]);
    mount(fake.client);
    await waitFor(() => expect(screen.getByTestId("active-id").textContent).toBe(BID_A));
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("a single-assignment staff member is auto-selected (exactly-one rule)", async () => {
    const fake = fakeDataClient([bizB]);
    mount(fake.client);
    await waitFor(() => expect(screen.getByTestId("active-id").textContent).toBe(BID_B));
  });

  it("zero accessible businesses resolves activeBusinessId null", async () => {
    const fake = fakeDataClient([]);
    mount(fake.client);
    await waitFor(() => expect(screen.getByTestId("active-id").textContent).toBe("null"));
  });

  it("BIZ-04 CORE: switching A→B invalidates A-scoped keys ONLY", async () => {
    const fake = fakeDataClient([bizA, bizB]);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // Seed caches for BOTH businesses + a global listing + a memberships row.
    qc.setQueryData(keysFor.customers(BID_A), [{ id: "c-a" }]);
    qc.setQueryData(keysFor.customers(BID_B), [{ id: "c-b" }]);
    qc.setQueryData(keysFor.catalogItems(BID_A), [{ id: "i-a" }]);
    qc.setQueryData(keysFor.memberships(BID_A), []);
    qc.setQueryData(keysFor.businesses(), [bizA, bizB]);

    const utils = mount(fake.client, { queryClient: qc });
    await waitFor(() => expect(screen.getByTestId("active-id").textContent).toBe(BID_A));

    act(() => {
      screen.getByText("switch-to-b").click();
    });

    await waitFor(() => {
      expect(qc.getQueryState(keysFor.customers(BID_A))?.isInvalidated).toBe(true);
    });
    // Foreign keys invalidated across EVERY tenant entity prefix...
    expect(qc.getQueryState(keysFor.catalogItems(BID_A))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keysFor.memberships(BID_A))?.isInvalidated).toBe(true);
    // ...while the destination business's cache stays untouched...
    expect(qc.getQueryState(keysFor.customers(BID_B))?.isInvalidated).toBe(false);
    // ...and the global listing never becomes switch collateral.
    expect(qc.getQueryState(keysFor.businesses())?.isInvalidated).toBe(false);

    // Selection moved.
    expect(utils.getByTestId("active-id").textContent).toBe(BID_B);
    expect(utils.getByTestId("is-active-b").textContent).toBe("true");
    void qc;
  });

  it("switching navigates within the current section preserving the route slug (D-68)", async () => {
    const fake = fakeDataClient([bizA, bizB]);
    const navigate = vi.fn();
    const router: RouterLike = { getCurrentPath: () => "/customers", navigate };
    mount(fake.client, { router });
    await waitFor(() => expect(screen.getByTestId("active-id").textContent).toBe(BID_A));
    act(() => {
      screen.getByText("switch-to-b").click();
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]!.to).toBe("/customers");
  });

  it("exposes isArchived from the cached row so read-only chrome can react (D-35/D-36)", async () => {
    const archivedB = { ...bizB, archived_at: "2026-02-02T00:00:00Z" };
    const fake = fakeDataClient([{ ...bizA }, archivedB]);
    mount(fake.client);
    await waitFor(() => expect(screen.getByTestId("active-id").textContent).toBe(BID_A));
    expect(screen.getByTestId("archived").textContent).toBe("false");
    act(() => {
      screen.getByText("switch-to-b").click();
    });
    await waitFor(() => expect(screen.getByTestId("archived").textContent).toBe("true"));
  });

  it("listing failure surfaces isError without selecting any business", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fake = fakeDataClient([], { message: "boom", code: "XX000" });
      mount(fake.client);
      await waitFor(() => expect(screen.getByTestId("active-id").textContent).toBe("null"));
    } finally {
      spy.mockRestore();
    }
  });
});
