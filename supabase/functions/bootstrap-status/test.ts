// bootstrap-status - dual-runtime handler tests (deps injected, zero network).

import { describe, expect, it, vi } from "vitest";
import { handleBootstrapStatus } from "./index";

type CountResult = { count: number | null; error: unknown };

function serviceWithCount(result: CountResult | (() => Promise<CountResult>)) {
  const chain = {
    select: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    // head/count select resolves through await of the builder itself
    then: undefined as never,
  };
  const client = {
    from: (_table: string) => {
      const builder = {
        select: () => builder,
        // vitest awaits the builder result through this thunk:
        count: undefined as unknown,
        ...({} as Record<string, never>),
      };
      Object.assign(builder, {
        then: (resolve: (r: CountResult) => void) => {
          const r = typeof result === "function" ? result() : Promise.resolve(result);
          return r.then(resolve);
        },
      });
      return builder;
    },
  };
  return client;
}

const ENV = { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_ROLE_KEY: "svc" };
const DEPS = { env: ENV, createServiceClient: () => serviceWithCount({ count: 3, error: null }) as never };

function post(): Request {
  return new Request("http://localhost/bootstrap-status", { method: "POST" });
}

describe("handleBootstrapStatus", () => {
  it("returns bootstrapped:true when profiles exist", async () => {
    const res = await handleBootstrapStatus(post(), DEPS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bootstrapped: true });
  });

  it("returns bootstrapped:false on a virgin project", async () => {
    const res = await handleBootstrapStatus(post(), {
      env: ENV,
      createServiceClient: () => serviceWithCount({ count: 0, error: null }) as never,
    });
    expect(await res.json()).toEqual({ bootstrapped: false });
  });

  it("maps probe errors loudly (500 probe_failed)", async () => {
    const res = await handleBootstrapStatus(post(), {
      env: ENV,
      createServiceClient: () => serviceWithCount({ count: null, error: { message: "rls" } }) as never,
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "probe_failed" } });
  });

  it("maps thrown transports to 502 network", async () => {
    const res = await handleBootstrapStatus(post(), {
      env: ENV,
      createServiceClient: () => {
        throw new TypeError("Failed to fetch");
      },
    } as never);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "network" } });
  });

  it("rejects non-POST with 405", async () => {
    const res = await handleBootstrapStatus(new Request("http://x", { method: "GET" }), DEPS);
    expect(res.status).toBe(405);
  });

  it("reports server_misconfigured without service env", async () => {
    const res = await handleBootstrapStatus(post(), { env: {} });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_misconfigured" } });
  });

  it("counts via head:true so no rows transfer", async () => {
    const selectOpts = vi.fn();
    const client = {
      from: () => ({
        select: (_cols: string, opts?: Record<string, unknown>) => {
          selectOpts(opts);
          return Promise.resolve({ count: 1, error: null });
        },
      }),
    };
    const res = await handleBootstrapStatus(post(), {
      env: ENV,
      createServiceClient: () => client as never,
    });
    expect(res.status).toBe(200);
    expect(selectOpts).toHaveBeenCalledWith(expect.objectContaining({ head: true, count: "exact" }));
  });

  // WR-07: WebView2 preflight must succeed before the packaged app can probe.
  it("answers OPTIONS preflight with 204 + CORS headers", async () => {
    const res = await handleBootstrapStatus(
      new Request("http://x", { method: "OPTIONS" }),
      DEPS,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("apikey");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("applies CORS headers to every JSON response (200 and errors)", async () => {
    for (const deps of [
      DEPS,
      { env: {} }, // server_misconfigured -> 500
    ] as const) {
      const res = await handleBootstrapStatus(post(), deps as never);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    const denied = await handleBootstrapStatus(new Request("http://x", { method: "GET" }), DEPS);
    expect(denied.status).toBe(405);
    expect(denied.headers.get("access-control-allow-origin")).toBe("*");
  });
});
