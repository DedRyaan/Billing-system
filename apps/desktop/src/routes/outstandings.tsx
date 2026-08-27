import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { OutstandingsSection } from "../screens/billing/OutstandingsSection";

export const Route = createFileRoute("/outstandings")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: OutstandingsSection,
});
