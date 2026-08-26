import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { CustomersScreen } from "../screens/customers/CustomersScreen";

// S5 Customers (plan 03-08): guard + real screen. Staff included per D-43 -
// the affordance predicate lives in the screen (all roles), RLS scopes rows.
function CustomersRoute() {
  return <CustomersScreen />;
}

export const Route = createFileRoute("/customers")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: CustomersRoute,
});
