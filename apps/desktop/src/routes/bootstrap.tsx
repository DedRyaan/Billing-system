import { createFileRoute, redirect } from "@tanstack/react-router";
import { getBootstrapState } from "../lib/session-seam";

// OWNERSHIP: this stub is REPLACED by plan 03-03 Task 3 (S2 first-run
// bootstrap screen wired to bootstrap-super-admin; D-73 probe gate).
function BootstrapStub() {
  return (
    <main aria-label="Set up your workspace">
      <h1>Set up your workspace</h1>
    </main>
  );
}

export const Route = createFileRoute("/bootstrap")({
  beforeLoad: () => {
    // Pre-bootstrap this is THE destination for everyone - no auth guard
    // here (precedence over everything, D-73).
    // Unreachable forever after the owner account exists (D-73); `/`
    // re-resolves by auth state (dashboard when signed in, login otherwise).
    if (getBootstrapState() === "bootstrapped") throw redirect({ to: "/" });
  },
  component: BootstrapStub,
});
