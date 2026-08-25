import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";

// GUARD: requireAuthenticatedPreserving (03-03). OWNERSHIP: this stub is REPLACED by plan 03-08 (S5 Customers CRUD - sheet,
// GSTIN auto-fetch machine, state matrix).
function CustomersStub() {
  return (
    <section aria-label="Customers">
      <h1>Customers</h1>
    </section>
  );
}

export const Route = createFileRoute("/customers")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: CustomersStub,
});


