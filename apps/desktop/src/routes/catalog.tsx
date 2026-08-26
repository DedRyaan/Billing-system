import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { CatalogScreen } from "../screens/catalog/CatalogScreen";

// S6 Catalog (plan 03-09): guard + real screen. Edit affordances are
// admin-predicated in the screen; staff rows open detail-only sheets (D-75).
function CatalogRoute() {
  return <CatalogScreen />;
}

export const Route = createFileRoute("/catalog")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: CatalogRoute,
});
