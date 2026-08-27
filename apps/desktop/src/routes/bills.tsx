import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { BillEntryScreen } from "../screens/billing/BillEntryScreen";

export const Route = createFileRoute("/bills")({
  validateSearch: (search: Record<string, unknown>): { invoiceId?: string } => ({
    ...(typeof search["invoiceId"] === "string" ? { invoiceId: search["invoiceId"] } : {}),
  }),
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: BillEntryScreen,
});
