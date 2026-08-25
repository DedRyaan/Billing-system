// Tracer slice test: boots the REAL route tree through the REAL providers and
// proves the auth branch end-to-end. No network.
//
//   (a) unauthenticated mount redirects to /login
//   (b) authenticated mount renders the /dashboard placeholder copy
//   (c) navigating to /bills swaps content WITHOUT remounting the root

import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMemoryHistory } from "@tanstack/react-router";
import { renderApp } from "./render-app";
import type { GoTrueSessionJSON } from "@billing/api/auth";

const DASHBOARD_COPY = "Your dashboard arrives in Phase 8 — outstandings and revenue at a glance.";
const BILLS_COPY = "Bill drafting arrives next — blank screen to final number in under 30 seconds.";

const SESSION: GoTrueSessionJSON = { access_token: "at", refresh_token: "rt" };

/** Scripted client whose restore result decides the launch state. */
function scriptedClient(restored: GoTrueSessionJSON | null): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: restored }, error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: "x" } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;
}

describe("app boot tracer", () => {
  it("redirects an unauthenticated mount to /login", async () => {
    await renderApp({ authClient: scriptedClient(null), initialEntry: "/" });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("renders the dashboard placeholder for an authenticated session", async () => {
    await renderApp({
      authClient: scriptedClient(SESSION),
      getProfile: async () => ({ locked_at: null, is_active: true }),
      initialEntry: "/",
    });
    expect(await screen.findByText(DASHBOARD_COPY)).toBeInTheDocument();
  });

  it("swaps to /bills without remounting the root layout", async () => {
    const { container, router } = await renderApp({
      authClient: scriptedClient(SESSION),
      getProfile: async () => ({ locked_at: null, is_active: true }),
      initialEntry: "/dashboard",
    });
    expect(await screen.findByText(DASHBOARD_COPY)).toBeInTheDocument();

    const rootBefore = container.querySelector("[data-shell-root]");
    expect(rootBefore).not.toBeNull();

    await act(async () => {
      await router.navigate({ to: "/bills" });
    });

    expect(container.querySelector("[data-shell-root]")).toBe(rootBefore);
    expect(screen.getByText(BILLS_COPY)).toBeInTheDocument();
  });

  it("guards protected routes for unauthenticated deep links", async () => {
    const history = createMemoryHistory({ initialEntries: ["/bills"] });
    await renderApp({ authClient: scriptedClient(null), history });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
