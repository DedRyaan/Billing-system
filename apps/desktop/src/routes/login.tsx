import { createFileRoute } from "@tanstack/react-router";
import { requireUnauthenticated } from "../auth/session-guards";

// OWNERSHIP: this stub is REPLACED by plan 03-03 Task 3 (S1 Sign-in screen,
// full fidelity per UI-SPEC S1 + auth wiring).
function LoginStub() {
  return (
    <main aria-label="Sign in">
      <h1>Sign in</h1>
    </main>
  );
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { reason?: string; redirect?: string } => ({
    ...(typeof search["reason"] === "string" ? { reason: search["reason"] } : {}),
    ...(typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {}),
  }),
  beforeLoad: () => requireUnauthenticated(),
  component: LoginStub,
});
