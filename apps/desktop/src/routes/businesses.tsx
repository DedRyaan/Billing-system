import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";

// GUARD: requireAuthenticatedPreserving (03-03). OWNERSHIP: this stub is REPLACED by plan 03-07 (S4 Businesses admin CRUD -
// sectioned business sheet, logo upload, archive/restore).
function BusinessesStub() {
  return (
    <section aria-label="Businesses">
      <h1>Businesses</h1>
    </section>
  );
}

export const Route = createFileRoute("/businesses")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: BusinessesStub,
});


