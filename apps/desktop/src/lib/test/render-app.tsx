import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type RouterHistory,
} from "@tanstack/react-router";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthProvider } from "../../auth/AuthProvider";
import { routeTree } from "../../routeTree.gen";

// Headless mount of the FULL production provider stack: AuthProvider wraps
// the router exactly like main.tsx. Tests inject a scripted client; when
// none is given an INERT client is used (restores to unauthenticated,
// emits nothing). Zero network anywhere.
//
// Redirect chains settle asynchronously - assert with findBy*/waitFor.

export interface RenderAppOptions extends Omit<RenderOptions, "wrapper"> {
  initialEntry?: string;
  history?: RouterHistory;
  /** Scripted fake client driving the real AuthProvider. */
  authClient?: SupabaseClient;
  /** Interceptor own-profile probe. */
  getProfile?: () => Promise<{ locked_at: string | null; is_active: boolean } | null>;
  /** Extra nodes rendered INSIDE AuthProvider but OUTSIDE the RouterProvider. */
  extra?: ReactNode;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Inert stand-in when a test does not care about auth state at all. */
export function inertAuthClient(): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: "inert" } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
      signOut: async () => ({ error: null }),
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
  } as unknown as SupabaseClient;
}

export async function renderApp(options: RenderAppOptions = {}) {
  const {
    initialEntry = "/",
    history = createMemoryHistory({ initialEntries: [initialEntry] }),
    authClient,
    getProfile,
    extra,
    ...renderOptions
  } = options;

  const queryClient = createTestQueryClient();
  const router = createRouter({ routeTree, history });

  let tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  tree = (
    <AuthProvider
      {...(authClient ? { authClient } : { authClient: inertAuthClient() })}
      {...(getProfile ? { getProfile } : {})}
      authRouter={router}
    >
      {extra}
      {tree}
    </AuthProvider>
  );

  const utils = render(tree, renderOptions);
  return { ...utils, router, queryClient };
}
