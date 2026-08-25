import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";

// Placeholder per UI-SPEC Copywriting table (exact copy). Replaced by the
// real dashboard in Phase 8 - the shell never restructures (D-66).
function DashboardPlaceholder() {
  return (
    <section aria-label="Dashboard placeholder">
      <h1>Dashboard</h1>
      <p>Your dashboard arrives in Phase 8 — outstandings and revenue at a glance.</p>
    </section>
  );
}

export const Route = createFileRoute("/dashboard")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: DashboardPlaceholder,
});


