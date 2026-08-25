import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type RouterHistory,
} from "@tanstack/react-router";
import { render, type RenderOptions } from "@testing-library/react";
import { setSessionState, type SessionState } from "../session-seam";
import { routeTree } from "../../routeTree.gen";

// Headless mount of the FULL provider stack with an injected session state.
// Zero network anywhere; the query client is created fresh per invocation.
// Redirect chains settle asynchronously - tests assert with findBy*/waitFor.

export interface RenderAppOptions extends Omit<RenderOptions, "wrapper"> {
  /** Injected auth branch - defaults to 'unauthenticated'. */
  session?: SessionState;
  initialEntry?: string;
  history?: RouterHistory;
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
    ...renderOptions
  } = options;

  setSessionState(session);
  const queryClient = createTestQueryClient();
  const router = createRouter({ routeTree, history });

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
    renderOptions,
  );

  return { ...utils, router, queryClient };
}
