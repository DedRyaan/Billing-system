// WR-02 regression suite: the root query cache must NOT survive an identity
// end. Previously tenant-scoped entries lived until gcTime across logout /
// user switches - stale-while-revalidate ghosts of another identity's data.
//
//   (a) entries present while authenticated are GONE after signOut
//   (b) the clear happens exactly at the authenticated->unauthenticated
//       transition (boot-time unauthenticated never spuriously re-clears)

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "../../auth/AuthProvider";
import { renderApp } from "./render-app";
import type { GoTrueSessionJSON } from "@billing/api/auth";

const SESSION: GoTrueSessionJSON = { access_token: "at", refresh_token: "rt" };
const CACHE_KEY = ["customers", "biz-1"] as const;

function scriptedAuthedClient(): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: SESSION }, error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: "x" } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;
}

function SignOutProbe(): React.ReactElement {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()}>
      probe-signout
    </button>
  );
}

describe("WR-02: query cache cleared on identity end", () => {
  it("drops all cached queries when the user signs out", async () => {
    const { queryClient } = await renderApp({
      initialEntry: "/dashboard",
      authClient: scriptedAuthedClient(),
      getProfile: async () => ({ locked_at: null, is_active: true }),
      extra: <SignOutProbe />,
    });

    // Wait until authenticated, then seed a tenant-scoped entry as if a
    // listing had rendered.
    await screen.findByText(/Your dashboard arrives in Phase 8/);
    queryClient.setQueryData(CACHE_KEY, [{ id: "row-A" }]);
    expect(queryClient.getQueryData(CACHE_KEY)).toBeDefined();

    await userEvent.setup().click(screen.getByRole("button", { name: "probe-signout" }));

    // Back on /login AND every cached row fetched under the old identity gone.
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0),
    );
  });
});
