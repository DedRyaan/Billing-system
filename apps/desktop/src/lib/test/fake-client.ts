// Reusable headless Supabase client double for SCREEN tests (plans 03-07..03-10).
//
// Table-driven: fixtures keyed by table name; chainable builder applies eq()
// filters generically and resolves arrays (select/maybeSingle->first row).
// Auth surface scripts restore/profile probes like render-app's inert client.
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ScriptedCallLog {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Array<{ col: string; op: string; val: unknown }>;
}

export interface ScriptedClientOptions {
  /** Restored session (null = unauthenticated boot). */
  session?: { access_token: string; refresh_token: string } | null;
  /** Own-profile row served to AuthProvider's probe (null -> no row). */
  profileRow?: Record<string, unknown> | null;
  /** Fixture rows keyed by table; returned for selects after eq-filtering. */
  tables?: Record<string, Array<Record<string, unknown>>>;
  /** Extra per-test behaviors: called with the captured call before resolving. */
  onSelect?: (table: string) => void;
  onWrite?: (call: ScriptedCallLog) => { error?: unknown } | void;
  channels?: Array<{ name: string; handlers: Array<(p: unknown) => void> }>;
}

export type ScriptedClient = SupabaseClient & ScriptedClientShape;

export function makeScriptedClient(options: ScriptedClientOptions = {}): ScriptedClient {
  const calls: ScriptedCallLog[] = [];
  const channels = options.channels ?? [];

  interface Chain {
    select(): Chain;
    insert(p: unknown): Chain;
    update(p: unknown): Chain;
    delete(): Chain;
    eq(col: string, val: unknown): Chain;
    order(): Chain;
    limit(): Chain;
    single(): Promise<{ data: unknown; error: unknown }>;
    maybeSingle(): Promise<{ data: unknown; error: unknown }>;
    then: PromiseLike<{ data: unknown; error: unknown }>["then"];
  }

  function run(table: string): Chain {
    const call: ScriptedCallLog = { table, op: "select", filters: [] };
    calls.push(call);

    const resolve = (): { data: unknown; error: unknown } => {
      const rows = options.tables?.[table] ?? [];
      const filtered = rows.filter((r) =>
        call.filters.every((f) => r[f.col] === f.val),
      );
      return { data: filtered, error: null };
    };

    const finish = (): { data: unknown; error: unknown } => {
      const writeOps = ["insert", "update", "delete"];
      if (!writeOps.includes(call.op)) return resolve();
      const outcome = options.onWrite?.(call) ?? {};
      return { data: resolve().data, error: outcome.error ?? null };
    };

    const chain: Chain = {
      select() {
        options.onSelect?.(table);
        return chain;
      },
      insert(payload) {
        call.op = "insert";
        call.payload = payload;
        return chain;
      },
      update(payload) {
        call.op = "update";
        call.payload = payload;
        return chain;
      },
      delete() {
        call.op = "delete";
        return chain;
      },
      eq(col, val) {
        call.filters.push({ col, op: "eq", val });
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      async single() {
        const res = finish();
        const arr = Array.isArray(res.data) ? res.data : [];
        return { data: arr[0] ?? null, error: res.error };
      },
      async maybeSingle() {
        const res = finish();
        const arr = Array.isArray(res.data) ? res.data : [];
        return { data: arr[0] ?? null, error: res.error };
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(finish()).then(onFulfilled as never, onRejected);
      },
    };
    return chain;
  }

  const client = {
    __calls: calls,
    __channels: channels,
    from(table: string) {
      return run(table);
    },
    rpc(name: string, args?: unknown) {
      calls.push({ table: `rpc:${name}`, op: "select", filters: [], payload: args });
      return Promise.resolve({ data: null, error: null });
    },
    channel(name: string) {
      const ch = { name, handlers: [] as Array<(p: unknown) => void> };
      channels.push(ch);
      const chain = {
        on(_t: string, _c: unknown, cb: (p: unknown) => void) {
          ch.handlers.push(cb);
          return chain;
        },
        subscribe() {
          return chain;
        },
      };
      return Object.assign(chain, { name });
    },
    removeChannel(ch: { name?: string }) {
      const idx = channels.findIndex((c) => c.name === ch?.name);
      if (idx >= 0) channels.splice(idx, 1);
      return Promise.resolve("ok");
    },
    auth: {
      getSession: async () => ({
        data: { session: options.session ?? null },
        error: null,
      }),
      getUser: async () => ({
        data: {
          user:
            options.session != null
              ? { id: (options.profileRow?.["id"] as string) ?? "user-1" }
              : null,
        },
        error: options.session != null ? null : { message: "no user" },
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
      signOut: vi.fn(async () => ({ error: null })),
    },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  } as unknown as SupabaseClient & ScriptedClientShape;

  return client;
}

export interface ScriptedClientShape {
  __calls: ScriptedCallLog[];
  __channels: Array<{ name: string; handlers: Array<(p: unknown) => void> }>;
}
