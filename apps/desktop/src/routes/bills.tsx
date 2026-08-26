import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { BillEntryScreen } from "../screens/billing/BillEntryScreen";

export const Route = createFileRoute("/bills")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: BillEntryScreen,
});
