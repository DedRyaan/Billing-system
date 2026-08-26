// Shared headless PostgREST fake: a chainable, awaitable query builder that
// captures every operation so suites assert payloads/filters exactly.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Filter {
  col: string;
  op: string;
  val: unknown;
}

export interface CapturedCall {
  table?: string;
  op?: "insert" | "update" | "delete" | "select" | "rpc";
  payload?: unknown;
  filters: Filter[];
  select?: string;
  selectOpts?: unknown;
  order?: { col: string; ascending: boolean };
  single?: boolean;
  maybeSingle?: boolean;
  rpcName?: string;
  rpcArgs?: unknown;
  channelName?: string;
  realtimeConfig?: unknown;
}

type Responder = (call: CapturedCall) => { data?: unknown; error?: unknown };

export interface FakeClientHandle {
  client: SupabaseClient;
  calls: CapturedCall[];
  functionCalls: Array<{ name: string; body: unknown }>;
  /** Queue the NEXT terminal resolution (data/error). */
  next(data: unknown, error?: unknown): void;
  /** Queue the NEXT terminal resolution for functions.invoke. */
  nextFunction(data: unknown, error?: unknown): void;
  channels: Array<{ name: string; config: unknown; subscribed: boolean }>;
  removedChannels: string[];
}

export function makeClient(): FakeClientHandle {
  const calls: CapturedCall[] = [];
  const functionCalls: Array<{ name: string; body: unknown }> = [];
  const queue: Array<{ data: unknown; error?: unknown }> = [];
  const functionQueue: Array<{ data: unknown; error?: unknown }> = [];
  const channels: FakeClientHandle["channels"] = [];
  const removedChannels: string[] = [];

  const current = (): CapturedCall => {
    if (calls.length === 0) calls.push({ filters: [] });
    return calls[calls.length - 1]!;
  };

  const respond = (): { data: unknown; error?: unknown } => {
    return queue.shift() ?? { data: null, error: null };
  };

  interface Builder {
    select(cols?: string, opts?: unknown): Builder;
    insert(payload: unknown, opts?: unknown): Builder;
    update(payload: unknown): Builder;
    delete(): Builder;
    eq(col: string, val: unknown): Builder;
    neq(col: string, val: unknown): Builder;
    order(col: string, opts?: { ascending?: boolean }): Builder;
    limit(n: number): Builder;
    single(): Builder;
    maybeSingle(): Builder;
    rpc(name: string, args?: unknown): Builder;
    then(
      onFulfilled?: (v: { data: unknown; error?: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ): PromiseLike<{ data: unknown; error?: unknown }>;
  }

  function builder(call: CapturedCall): Builder {
    const b: Builder = {
      select(cols?: string, opts?: unknown) {
        call.select = cols ?? "*";
        call.selectOpts = opts;
        return builder(call);
      },
      insert(payload: unknown, opts?: unknown) {
        call.op = "insert";
        call.payload = payload;
        void opts;
        return builder(call);
      },
      update(payload: unknown) {
        call.op = "update";
        call.payload = payload;
        return builder(call);
      },
      delete() {
        call.op = "delete";
        return builder(call);
      },
      eq(col: string, val: unknown) {
        call.filters.push({ col, op: "eq", val });
        return builder(call);
      },
      neq(col: string, val: unknown) {
        call.filters.push({ col, op: "neq", val });
        return builder(call);
      },
      order(col: string, opts?: { ascending?: boolean }) {
        call.order = { col, ascending: opts?.ascending ?? true };
        return builder(call);
      },
      limit(_n: number) {
        return builder(call);
      },
      single() {
        call.single = true;
        return builder(call);
      },
      maybeSingle() {
        call.maybeSingle = true;
        return builder(call);
      },
      rpc(name: string, args?: unknown) {
        call.op = "rpc";
        call.rpcName = name;
        call.rpcArgs = args;
        return builder(call);
      },
    then(
      onFulfilled?: (v: { data: unknown; error?: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ): PromiseLike<{ data: unknown; error?: unknown }> {
      return Promise.resolve(respond()).then(
        onFulfilled as never,
        onRejected,
      ) as PromiseLike<{ data: unknown; error?: unknown }>;
    },
    };
    return b;
  }

  const client = {
    from(table: string) {
      calls.push({ table, filters: [] });
      return builder(calls[calls.length - 1]!);
    },
    rpc(name: string, args?: unknown) {
      calls.push({ rpcName: name, rpcArgs: args, filters: [], op: "rpc" });
      return builder(calls[calls.length - 1]!);
    },
    functions: {
      invoke(name: string, opts?: { body?: unknown }) {
        functionCalls.push({ name, body: opts?.body });
        const res = functionQueue.shift() ?? { data: null, error: null };
        return Promise.resolve(res);
      },
    },
    channel(name: string) {
      calls.push({ channelName: name, filters: [] });
      const handle = { name, config: undefined as unknown, subscribed: false };
      channels.push(handle);
      // The chain object carries its name so removeChannel(ch) resolves it.
      const ch = {
        name,
        on(_type: string, config: unknown, _cb: unknown) {
          handle.config = config;
          return ch;
        },
        subscribe() {
          handle.subscribed = true;
          return ch;
        },
      };
      return ch;
    },
    removeChannel(ch: { name?: string }) {
      if (ch?.name) removedChannels.push(ch.name);
      return Promise.resolve("ok");
    },
  } as unknown as SupabaseClient;

  return {
    client,
    calls,
    functionCalls,
    channels,
    removedChannels,
    next(data: unknown, error?: unknown) {
      queue.push({ data, error });
    },
    nextFunction(data: unknown, error?: unknown) {
      functionQueue.push({ data, error });
    },
  };
}
