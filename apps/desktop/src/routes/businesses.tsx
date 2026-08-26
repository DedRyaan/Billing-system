import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { BusinessesScreen } from "../screens/businesses/BusinessesScreen";
import { useAuth } from "../auth/AuthProvider";
import type { LogoStorageDeps } from "@billing/api/logos";

// S4 Businesses (plan 03-07): guard + real screen.
//
// WR-06 (D-79 single door): logo storage deps derive from THE provider's
// authenticated client - this route no longer constructs its own
// createBillingClient (a divergent GoTrue instance could ride a stale access
// token after an in-app sign-out/sign-in). Tests inject doubles through
// BusinessesScreen's logoDeps prop instead.
function BusinessesRoute() {
  const auth = useAuth();
  const logoDeps = useMemo<LogoStorageDeps | null>(
    () => (auth.client !== null ? { storage: auth.client.storage } : null),
    [auth.client],
  );

  return <BusinessesScreen {...(logoDeps !== null ? { logoDeps } : {})} />;
}

export const Route = createFileRoute("/businesses")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: BusinessesRoute,
});
