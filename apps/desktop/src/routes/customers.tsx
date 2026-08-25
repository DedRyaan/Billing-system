import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionState } from "../lib/session-seam";

// OWNERSHIP: this stub is REPLACED by plan 03-08 (S5 Customers CRUD - sheet,
// GSTIN auto-fetch machine, state matrix).
function CustomersStub() {
  return (
    <section aria-label="Customers">
      <h1>Customers</h1>
    </section>
  );
}

export const Route = createFileRoute("/customers")({
  beforeLoad: () => {
    if (getSessionState() !== "authenticated") throw redirect({ to: "/login" });
  },
  component: CustomersStub,
});
