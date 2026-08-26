import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { SettingsScreen } from "../screens/settings/SettingsScreen";

// S8 Settings (plan 03-10): guard + real screen. Team section mounts for
// admins only; sign-out duplicates the sidebar footer control (D-71).
function SettingsRoute() {
  return <SettingsScreen />;
}

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: SettingsRoute,
});
