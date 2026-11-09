// useBusinessRealtime contract tests (plan 03-06 Task 1, D-81/T-3-21/T-3-23).
//
// Proven here: subscription lifecycle (subscribe on mount with the EXACT
// business_id filter, unsubscribe on unmount/business change, StrictMode
// double-mount safety), scoped invalidation (a pushed change invalidates
// keysFor.<entity>(businessId) prefixes), and the defensive foreign-event
// guard - an event for ANOTHER business can never invalidate this one's keys.
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor, act } from "@testing-library/react";
import { StrictMode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keysFor } from "@billing/api/query-keys";
import { useBusinessRealtime } from "./useBusinessRealtime";

const BID_A = "aaaaaaaa-1111-1111-1111-111111111111";
const BID_B = "bbbbbbbb-2222-2222-2222-222222222222";

interface FakeChannel {
  name: string;
  handlers: Array<(payload: unknown) => void>;
  emit(payload: unknown): void;
}

function fakeRealtimeClient() {
  const channels: FakeChannel[] = [];
  const removed: string[] = [];
  const client = {
    channel(name: string) {
      const ch: FakeChannel = {
        name,
        handlers: [],
        emit(payload: unknown) {
          for (const h of this.handlers) h(payload);
        },
      };
      const chain = {
        on(_t: string, _c: unknown, cb: (p: unknown) => void) {
          ch.handlers.push(cb);
          return chain;
        },
        subscribe() {
          return chain;
        },
      };
      // Bridge: subscribeToEntity chains .on(...).subscribe() off channel().
      const wrapped = Object.assign(chain, {}) as unknown;
      ch.emit.bind(ch);
      void wrapped;
      channels.push(ch);
      // Return an object whose on/subscribe feed ch.handlers; carries the
      // name so removeChannel(ch) resolves identity like real supabase-js.
      const out = {
        name,
        on(_t: string, _c: unknown, cb: (p: unknown) => void) {
          ch.handlers.push(cb);
          return out;
        },
        subscribe() {
          return out;
        },
      };
      return out;
    },
    removeChannel(ch: { name?: string }) {
      removed.push(ch?.name ?? "?");
      return Promise.resolve("ok");
    },
  } as unknown as SupabaseClient & { __channels?: FakeChannel[] };
  (client as unknown as { __channels: FakeChannel[] }).__channels = channels;
  (client as unknown as { __removed: string[] }).__removed = removed;
  return client as unknown as SupabaseClient & { __channels: FakeChannel[]; __removed: string[] };
}

function Probe({
  client,
  entity,
  businessId,
}: {
  client: SupabaseClient | null;
  entity: Parameters<typeof useBusinessRealtime>[1];
  businessId: string | null | undefined;
}) {
  useBusinessRealtime(client, entity, businessId);
  return <output data-testid="probe">live</output>;
}

function mountHook(
  client: SupabaseClient | null,
  entity: Parameters<typeof useBusinessRealtime>[1],
  businessId: string | null | undefined,
  opts: { strict?: boolean; qc?: QueryClient } = {},
) {
  const qc =
    opts.qc ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  const tree = (
    <QueryClientProvider client={qc}>
      <Probe client={client} entity={entity} businessId={businessId} />
    </QueryClientProvider>
  );
  const utils = render(opts.strict === true ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...utils, qc };
}

describe("useBusinessRealtime", () => {
  it("subscribes with the exact tenant filter when businessId is present", async () => {
    const client = fakeRealtimeClient();
    mountHook(client, "customers", BID_A);
    await waitFor(() => {
      const ch = client.__channels[0];
      expect(ch).toBeDefined();
      expect(ch!.name).toBe(`entity:customers:${BID_A}`);
    });
  });

  it("does NOT subscribe when businessId is absent", () => {
    const client = fakeRealtimeClient();
    mountHook(client, "customers", null);
    expect(client.__channels.length).toBe(0);
    mountHook(client, "catalog_items", undefined);
    expect(client.__channels.length).toBe(0);
  });

  it("pushed change for the ACTIVE business invalidates its query-key prefix only", async () => {
    const client = fakeRealtimeClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keysFor.customers(BID_A), [{ id: "c1" }]);
    qc.setQueryData(keysFor.customers(BID_B), [{ id: "c2" }]);
    qc.setQueryData(keysFor.catalogItems(BID_A), []);

    mountHook(client, "customers", BID_A, { qc });
    await waitFor(() => expect(client.__channels.length).toBe(1));

    act(() => {
      client.__channels[0]!.emit({
        eventType: "INSERT",
        new: { id: "c9", business_id: BID_A },
      });
    });

    await waitFor(() => {
      expect(qc.getQueryState(keysFor.customers(BID_A))?.isInvalidated).toBe(true);
    });
    expect(qc.getQueryState(keysFor.customers(BID_B))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keysFor.catalogItems(BID_A))?.isInvalidated).toBe(false);
  });

  it("FOREIGN-BUSINESS EVENT GUARD: a pushed event for another business never invalidates (T-3-23)", async () => {
    const client = fakeRealtimeClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keysFor.customers(BID_A), [{ id: "c1" }]);

    mountHook(client, "customers", BID_A, { qc });
    await waitFor(() => expect(client.__channels.length).toBe(1));

    act(() => {
      // Server-side filters make this impossible in production; a spoofed or
      // buggy delivery must still not touch our cache slots.
      client.__channels[0]!.emit({
        eventType: "UPDATE",
        new: { id: "x", business_id: BID_B },
      });
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(qc.getQueryState(keysFor.customers(BID_A))?.isInvalidated).toBe(false);
  });

  it("unsubscribes on unmount and re-subscribes on business change", async () => {
    const client = fakeRealtimeClient();
    const { unmount, rerender } = mountHook(client, "customers", BID_A);
    await waitFor(() => expect(client.__channels.length).toBe(1));

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <Probe client={client} entity="customers" businessId={BID_B} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(client.__removed).toContain(`entity:customers:${BID_A}`);
      expect(client.__channels.filter((c) => c.name === `entity:customers:${BID_B}`).length).toBe(1);
    });
    unmount();
    await waitFor(() => {
      expect(client.__removed).toContain(`entity:customers:${BID_B}`);
    });
  });

  it("StrictMode double-mount stays single-channel live (idempotent subscribe)", async () => {
    const client = fakeRealtimeClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keysFor.customers(BID_A), []);
    mountHook(client, "customers", BID_A, { strict: true, qc });

    await waitFor(() => {
      expect(client.__removed.length).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(client.__channels.filter((c) => c.name === `entity:customers:${BID_A}`).length).toBe(2);
      expect(client.__removed.filter((n) => n === `entity:customers:${BID_A}`).length).toBe(1);
    });

    // Still functional after the remount: events invalidate.
    act(() => {
      const live = client.__channels
        .filter((c) => c.name === `entity:customers:${BID_A}`)
        .at(-1)!;
      live.emit({ eventType: "INSERT", new: { id: "z", business_id: BID_A } });
    });
    await waitFor(() => {
      expect(qc.getQueryState(keysFor.customers(BID_A))?.isInvalidated).toBe(true);
    });
  });
});

describe("useBusinessRealtime — billing entities (live sync)", () => {
  it("a payment event refreshes payments, invoices and outstandings for the business only", async () => {
    const client = fakeRealtimeClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keysFor.payments(BID_A, "inv-1"), []);
    qc.setQueryData(keysFor.invoices(BID_A), []);
    qc.setQueryData(keysFor.outstandings(BID_A), []);
    qc.setQueryData(keysFor.invoices(BID_B), []);

    mountHook(client, "payments", BID_A, { qc });
    await waitFor(() => expect(client.__channels.length).toBe(1));
    expect(client.__channels[0]!.name).toBe(`entity:payments:${BID_A}`);

    act(() => {
      client.__channels[0]!.emit({ eventType: "INSERT", new: { id: "p1", business_id: BID_A, invoice_id: "inv-1" } });
    });

    expect(qc.getQueryState(keysFor.payments(BID_A, "inv-1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keysFor.invoices(BID_A))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keysFor.outstandings(BID_A))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keysFor.invoices(BID_B))?.isInvalidated).toBe(false);
  });

  it("an invoice event refreshes invoices and outstandings, ignoring foreign rows", async () => {
    const client = fakeRealtimeClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keysFor.invoices(BID_A), []);
    qc.setQueryData(keysFor.outstandings(BID_A), []);

    mountHook(client, "invoices", BID_A, { qc });
    await waitFor(() => expect(client.__channels.length).toBe(1));

    act(() => {
      client.__channels[0]!.emit({ eventType: "UPDATE", new: { id: "i1", business_id: BID_B } });
    });
    expect(qc.getQueryState(keysFor.invoices(BID_A))?.isInvalidated).toBe(false);

    act(() => {
      client.__channels[0]!.emit({ eventType: "UPDATE", new: { id: "i1", business_id: BID_A } });
    });
    expect(qc.getQueryState(keysFor.invoices(BID_A))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keysFor.outstandings(BID_A))?.isInvalidated).toBe(true);
  });
});
