// D-73 first-run gate (CR-01 fix): the deployed bootstrap-status probe runs
// during AuthProvider's restore window - BEFORE the router mounts - so the
// route guards see server truth on first resolution.
//
//   (a) fresh install (zero profiles): probe fires during boot, / routes to
//       /bootstrap instead of everything
//   (b) established install: probe fires once, bootstrapped=true, / shows
//       /login exactly as before
//   (c) authenticated + bootstrapped: a /bootstrap deep link redirects away
//       (the "disappears forever" contract)
//   (d) probe failure (transport OR error envelope): seam holds 'unknown' -
//       guards degrade open, launch is never bricked by a flaky network

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderApp } from "./render-app";
import type { GoTrueSessionJSON } from "@billing/api/auth";

const DASHBOARD_COPY =
  "Your dashboard arrives in Phase 8 — outstandings and revenue at a glance.";

const SESSION: GoTrueSessionJSON = { access_token: "at", refresh_token: "rt" };

/** Scripted client whose functions.invoke decides the first-run answer. */
function scriptedClient(opts: {
  restored: GoTrueSessionJSON | null;
  invoke?: (fn: string, opts?: { body?: unknown }) => Promise<unknown>;
}): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: opts.restored }, error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: "x" } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
      signOut: async () => ({ error: null }),
    },
    functions: {
      invoke: opts.invoke ?? (async () => ({ data: { bootstrapped: true }, error: null })),
    },
  } as unknown as SupabaseClient;
}

describe("D-73 bootstrap gate wiring", () => {
  it("probes bootstrap-status during boot and routes a fresh install to /bootstrap", async () => {
    const invoke = vi.fn(async () => ({ data: { bootstrapped: false }, error: null }));
    await renderApp({
      authClient: scriptedClient({ restored: null, invoke }),
      initialEntry: "/",
    });
    expect(
      await screen.findByRole("heading", { name: "Set up your workspace" }),
    ).toBeInTheDocument();
    // The probe IS the deployed Edge Function over this client (CR-01).
    expect(invoke).toHaveBeenCalledWith("bootstrap-status", { body: {} });
  });

  it("keeps an established unauthenticated install on /login after a bootstrapped probe", async () => {
    const invoke = vi.fn(async () => ({ data: { bootstrapped: true }, error: null }));
    await renderApp({
      authClient: scriptedClient({ restored: null, invoke }),
      initialEntry: "/",
    });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("makes /bootstrap unreachable for an authenticated user once bootstrapped", async () => {
    await renderApp({
      authClient: scriptedClient({ restored: SESSION }),
      getProfile: async () => ({ locked_at: null, is_active: true }),
      initialEntry: "/bootstrap",
    });
    expect(await screen.findByText(DASHBOARD_COPY)).toBeInTheDocument();
  });

  it("degrades open when the probe transport fails - no forced /bootstrap offline", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("network down");
    });
    await renderApp({
      authClient: scriptedClient({ restored: null, invoke }),
      initialEntry: "/",
    });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("degrades open when the probe answers with an error envelope", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { code: "probe_failed" } }));
    await renderApp({
      authClient: scriptedClient({ restored: null, invoke }),
      initialEntry: "/",
    });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
