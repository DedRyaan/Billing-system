import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { HeaderRow } from "../shell/HeaderRow";
import { PlaceholderScreen } from "../shell/PlaceholderScreen";
import {
  PLACEHOLDER_DASHBOARD_BODY,
  PLACEHOLDER_DASHBOARD_TITLE,
} from "../lib/strings/shell";

// Placeholder per UI-SPEC Copywriting table (exact copy, S3 ghost). Replaced
// by the real dashboard in Phase 8 - the shell never restructures (D-66).
function DashboardPlaceholder() {
  return (
    <>
      <HeaderRow title={PLACEHOLDER_DASHBOARD_TITLE} />
      <PlaceholderScreen
        icon={<LayoutDashboard size={40} aria-hidden="true" />}
        title={PLACEHOLDER_DASHBOARD_TITLE}
        body={PLACEHOLDER_DASHBOARD_BODY}
      />
    </>
  );
}

export const Route = createFileRoute("/dashboard")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: DashboardPlaceholder,
});
