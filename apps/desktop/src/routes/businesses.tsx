import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedPreserving } from "../auth/session-guards";
import { BusinessesScreen } from "../screens/businesses/BusinessesScreen";
import { createBillingClient } from "@billing/api/client";
import { readBillingEnv } from "../lib/env";
import { resolveSessionStorage } from "@billing/api/session-storage";
import type { LogoStorageDeps } from "@billing/api/logos";

// S4 Businesses (plan 03-07): guard + real screen. Logo storage deps build
// lazily from the env client (D-79 single door); headless tests inject
// doubles through BusinessesScreen's logoDeps prop instead.
let logoDepsPromise: Promise<LogoStorageDeps> | null = null;

function resolveLogoDeps(): Promise<LogoStorageDeps> {
  logoDepsPromise ??= (async () => {
    const storage = await resolveSessionStorage();
    const client = createBillingClient(
      readBillingEnv(import.meta.env as unknown as Record<string, unknown>),
      { storage },
    );
    return { storage: client.storage };
  })();
  return logoDepsPromise;
}

function BusinessesRoute() {
  const [logoDeps, setLogoDeps] = useState<LogoStorageDeps | null>(null);

  useEffect(() => {
    let mounted = true;
    resolveLogoDeps()
      .then((deps) => {
        if (mounted) setLogoDeps(deps);
      })
      .catch(() => undefined); // env problems surface elsewhere; upload stays hidden
    return () => {
      mounted = false;
    };
  }, []);

  return <BusinessesScreen {...(logoDeps !== null ? { logoDeps } : {})} />;
}

export const Route = createFileRoute("/businesses")({
  beforeLoad: ({ location }) => requireAuthenticatedPreserving(location.pathname),
  component: BusinessesRoute,
});
