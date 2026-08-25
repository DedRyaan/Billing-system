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
import { setSessionState, type SessionState } from "../session-seam";
import { routeTree } from "../../routeTree.gen";

// Headless mount of the FULL provider stack. Two modes:
//  - tracer mode (no authClient): session seam set directly, plain router.
//  - auth mode (authClient given): the REAL AuthProvider wraps the tree and
//    drives restore/interceptor/sign-out with injected fakes. Zero network.
//
// Redirect chains settle asynchronously - tests assert with findBy*/waitFor.

export interface RenderAppOptions extends Omit<RenderOptions, "wrapper"> {
  /** Injected auth branch for tracer mode - defaults to 'unauthenticated'. */
  session?: SessionState;
  initialEntry?: string;
  history?: RouterHistory;
  /** Auth mode: scripted fake client driving the real AuthProvider. */
  authClient?: SupabaseClient;
  /** Auth mode: interceptor own-profile probe. */
  getProfile?: () => Promise<{ locked_at: string | null; is_active: boolean } | null>;
  /** Extra nodes rendered INSIDE AuthProvider but OUTSIDE the RouterProvider (contract probes). */
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

export async function renderApp(options: RenderAppOptions = {}) {
  const {
    session = "unauthenticated",
    initialEntry = "/",
    history = createMemoryHistory({ initialEntries: [initialEntry] }),
    authClient,
    getProfile,
    extra,
    ...renderOptions
  } = options;

  if (!authClient) setSessionState(session);

  const queryClient = createTestQueryClient();
  const router = createRouter({ routeTree, history });

  let tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  if (authClient) {
    tree = (
      <AuthProvider
        authClient={authClient}
        {...(getProfile ? { getProfile } : {})}
        authRouter={router}
      >
        {extra}
        {tree}
      </AuthProvider>
    );
  }

  const utils = render(tree, renderOptions);
  return { ...utils, router, queryClient };
}
