import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { readBillingEnv } from "./lib/env";
import { createAppRouter } from "./router";
import "./styles/app.css";

// Fail fast before any screen mounts: env problems are construction-time,
// never mid-session surprises.
const env = readBillingEnv(
  import.meta.env as unknown as Record<string, unknown>,
);

const queryClient = new QueryClient();
const router = createAppRouter();

// biome-ignore lint/style/noNonNullAssertion: vite index.html guarantees #root
const container = document.getElementById("root")!;
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

export { env };
