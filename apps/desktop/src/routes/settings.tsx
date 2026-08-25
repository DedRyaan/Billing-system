import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";

// GUARD: requireAuthenticatedPreserving (03-03). OWNERSHIP: this stub is REPLACED by plan 03-10 (S8 Settings assembly +
// S7 Team & memberships for admins).
function SettingsStub() {
  return (
    <section aria-label="Settings">
      <h1>Settings</h1>
    </section>
  );
}

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: SettingsStub,
});


