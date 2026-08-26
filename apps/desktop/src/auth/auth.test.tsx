// Provider/interceptor/guards behaviors (plan 03-03 Task 2).
// The no-half-auth guarantee, proven headlessly with scripted fake clients.

import { act, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthProvider as _AuthProviderBrand, useAuth } from "./AuthProvider";
void _AuthProviderBrand;
import { renderApp } from "../lib/test/render-app";
import { setBootstrapState, setSessionState } from "../lib/session-seam";
import type { GoTrueSessionJSON } from "@billing/api/auth";

/** Scriptable fake auth client: restore result + event emitter + signOut. */
function fakeAuthClient(options: { restoredSession?: GoTrueSessionJSON | null }) {
  type Handler = (event: string, session: unknown) => void;
  const handlers = new Set<Handler>();
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: options.restoredSession ?? null },
        error: null,
      }),
      getUser: async () => ({ data: { user: null }, error: { message: "no user" } }),
      onAuthStateChange: (cb: Handler) => {
        handlers.add(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => void handlers.delete(cb),
            },
          },
        };
      },
      // Models real auth-js: the local SIGNED_OUT echo fires DURING signOut.
      signOut: vi.fn(async () => {
        handlers.forEach((h) => h("SIGNED_OUT", null));
        return { error: null };
      }),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    fire: (event: string, session: unknown = null) =>
      handlers.forEach((h) => h(event, session)),
  };
}

const SESSION: GoTrueSessionJSON = { access_token: "at", refresh_token: "rt" };

/** Contract probe: exposes the provider's signOut through the DOM. */
function LiveSignOutProbe(): React.ReactElement {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()}>
      probe-signout
    </button>
  );
}

describe("flash-free restore", () => {
  it("launches straight to the dashboard when a persisted session exists - login text NEVER appears", async () => {
    const { client } = fakeAuthClient({ restoredSession: SESSION });
    await renderApp({
      initialEntry: "/dashboard",
      authClient: client,
      getProfile: async () => ({ locked_at: null, is_active: true }),
    });
    expect(await screen.findByText(/Your dashboard arrives in Phase 8/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("an unauthenticated launch lands on login", async () => {
    const { client } = fakeAuthClient({ restoredSession: null });
    await renderApp({ initialEntry: "/dashboard", authClient: client });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("restoring renders NOTHING - no half-auth flash in either direction", async () => {
    let releaseRestore: ((v: { data: { session: GoTrueSessionJSON | null }; error: null }) => void) =
      () => undefined;
    const gatedClient = {
      auth: {
        getSession: () =>
          new Promise<{ data: { session: GoTrueSessionJSON | null }; error: null }>(
            (resolve) => {
              releaseRestore = resolve;
            },
          ),
        getUser: async () => ({ data: { user: null }, error: { message: "x" } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => undefined } },
        }),
        signOut: async () => ({ error: null }),
      },
    } as unknown as SupabaseClient;
    const { container } = await renderApp({
      initialEntry: "/dashboard",
      authClient: gatedClient,
    });
    // While restoring: nothing mounted at all.
    expect(container.querySelector("[data-shell-root]")).toBeNull();
    releaseRestore({ data: { session: SESSION }, error: null });
    expect(await screen.findByText(/Your dashboard arrives in Phase 8/)).toBeInTheDocument();
  });
});

describe("post-hoc failure taxonomy via interceptor", () => {
  it.each([
    [{ locked_at: "2026-01-01T00:00:00Z", is_active: true }, "locked"],
    [{ locked_at: null, is_active: false }, "deactivated"],
    [{ locked_at: null, is_active: true }, "ended"],
    [null, "ended"],
  ] as const)("refresh_rejected + profile %s routes to ?reason=%s", async (profile, reason) => {
    const { client, fire } = fakeAuthClient({ restoredSession: SESSION });
    const getProfile = vi.fn().mockResolvedValue(profile);
    const { router } = await renderApp({
      initialEntry: "/dashboard",
      authClient: client,
      getProfile,
    });
    // Restore must complete FIRST - otherwise nobody subscribes to auth events.
    expect(await screen.findByText(/Your dashboard arrives in Phase 8/)).toBeInTheDocument();

    await act(async () => {
      fire("SIGNED_OUT", null);
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
      expect(router.state.location.search).toMatchObject({ reason });
    });
  });
});

describe("explicit local signOut", () => {
  it("suppresses the echo: no taxonomy probe, lands /login reason-less", async () => {
    const { client } = fakeAuthClient({ restoredSession: SESSION });
    const getProfile = vi.fn().mockResolvedValue({ locked_at: null, is_active: true });
    const { router } = await renderApp({
      initialEntry: "/dashboard",
      authClient: client,
      getProfile,
      extra: <LiveSignOutProbe />,
    });
    expect(await screen.findByText(/Your dashboard arrives in Phase 8/)).toBeInTheDocument();

    const u = userEvent.setup();
    await u.click(screen.getByText("probe-signout"));

    await waitFor(() => {
      expect(client.auth.signOut).toHaveBeenCalled();
      expect(router.state.location.pathname).toBe("/login");
      expect(router.state.location.search).toEqual({});
    });
    // Suppressed: the SIGNED_OUT echo never reached the interceptor.
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("provider status flips to unauthenticated after signOut", async () => {
    const { client } = fakeAuthClient({ restoredSession: SESSION });
    let observed: string | null = null;
    function StatusProbe(): React.ReactElement {
      const { status, signOut } = useAuth();
      return (
        <>
          <span>status:{status}</span>
          <button type="button" onClick={() => void signOut()}>
            probe-status-signout
          </button>
        </>
      );
    }
    void observed;
    const { findByText, getByText } = await renderApp({
      initialEntry: "/dashboard",
      authClient: client,
      extra: <StatusProbe />,
    });
    expect(await findByText("status:authenticated")).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(getByText("probe-status-signout"));
    await waitFor(() => {
      expect(getByText("status:unauthenticated")).toBeInTheDocument();
    });
  });
});

describe("route guards", () => {
  it("unauthenticated visiting a protected route redirects to /login preserving intent", async () => {
    setSessionState("unauthenticated");
    const { client } = fakeAuthClient({ restoredSession: null });
    const { router } = await renderApp({
      initialEntry: "/customers",
      authClient: client,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
      expect(router.state.location.search).toMatchObject({ redirect: "/customers" });
    });
  });

  it("authenticated visiting /login redirects to /dashboard", async () => {
    const { client } = fakeAuthClient({ restoredSession: SESSION });
    const { router } = await renderApp({
      initialEntry: "/login",
      authClient: client,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard");
    });
  });

  it("authenticated visiting /bootstrap redirects away forever", async () => {
    setBootstrapState("bootstrapped");
    const { client } = fakeAuthClient({ restoredSession: SESSION });
    const { router } = await renderApp({
      initialEntry: "/bootstrap",
      authClient: client,
    });
    await waitFor(() => {
      expect(["/", "/dashboard"]).toContain(router.state.location.pathname);
    });
  });
});

describe("bootstrap precedence", () => {
  it("bootstrapped=false forces /bootstrap INSTEAD of everything (even authenticated)", async () => {
    setBootstrapState("unbootstrapped");
    const { client } = fakeAuthClient({ restoredSession: SESSION });
    const { router } = await renderApp({
      initialEntry: "/customers",
      authClient: client,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/bootstrap");
    });
  });

  it("after bootstrap completes, /bootstrap becomes unreachable for unauthenticated users too", async () => {
    setBootstrapState("bootstrapped");
    const { client } = fakeAuthClient({ restoredSession: null });
    const { router } = await renderApp({
      initialEntry: "/bootstrap",
      authClient: client,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
  });
});

describe("cross-identity profile hygiene (WR-03)", () => {
  it("adopting a different identity never renders the previous user's role", async () => {
    // First profiles read -> user A (admin). Every later read -> user B (staff).
    let reads = 0;
    const { client } = fakeAuthClient({ restoredSession: SESSION });
    const scripted = Object.assign(client, {
      auth: Object.assign({}, client.auth, {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "user-1",
                role: reads++ === 0 ? "admin" : "staff",
                is_active: true,
                locked_at: null,
              },
              error: null,
            }),
          }),
        }),
      }),
    }) as unknown as SupabaseClient;

    // Record EVERY role value the provider ever renders so the test can
    // inspect the exact sequence around the identity switch.
    const seenRoles: string[] = [];
    function IdentityProbe(): React.ReactElement {
      const { role, adoptReturnedSession } = useAuth();
      seenRoles.push(role ?? "none");
      return (
        <button
          type="button"
          onClick={() => void adoptReturnedSession({ access_token: "at-B", refresh_token: "rt-B" })}
        >
          probe-adopt
        </button>
      );
    }

    await renderApp({
      initialEntry: "/dashboard",
      authClient: scripted,
      extra: <IdentityProbe />,
    });

    // User A's server-controlled role is live.
    await waitFor(() => expect(seenRoles).toContain("admin"));

    const mark = seenRoles.length;
    await act(async () => {
      screen.getByRole("button", { name: "probe-adopt" }).click();
    });
    // User B's own truth replaces it.
    await waitFor(() => expect(seenRoles.slice(mark)).toContain("staff"));
    // THE CONTRACT: after the switch begins, NO render may show A's role -
    // not even transiently before B's refetch lands.
    expect(seenRoles.slice(mark)).not.toContain("admin");
  });
});
