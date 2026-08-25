import { createBrowserHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Production router (browser history). Tests build their own instances over
// createMemoryHistory via the same factory contract.
export function createAppRouter() {
  const router = createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent",
  });
  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;
