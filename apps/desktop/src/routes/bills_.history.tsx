import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { BillHistoryScreen } from "../screens/billing/BillHistoryScreen";

// /bills/history — sibling of /bills (trailing underscore = not nested under
// the bill-entry route, which renders no <Outlet/>).
export const Route = createFileRoute("/bills_/history")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: BillHistoryRoute,
});

function BillHistoryRoute() {
  const navigate = useNavigate();
  return (
    <BillHistoryScreen
      onOpenBill={(invoiceId) => void navigate({ to: "/bills", search: { invoiceId } })}
      onNewBill={() => void navigate({ to: "/bills", search: {} })}
    />
  );
}
