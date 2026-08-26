import { createFileRoute, useRouter } from "@tanstack/react-router";
import { requireUnauthenticated, safeRedirectTarget } from "../auth/session-guards";
import { LoginScreen } from "../screens/login/LoginScreen";

// S1 Sign-in - full-fidelity screen replacing the tracer stub (plan 03-03).
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { reason?: string; redirect?: string } => ({
    ...(typeof search["reason"] === "string" ? { reason: search["reason"] } : {}),
    ...(typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {}),
  }),
  beforeLoad: () => requireUnauthenticated(),
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const router = useRouter();
  return (
    <LoginScreen
      {...(search.reason ? { initialReason: search.reason } : {})}
      {...(search.redirect ? { redirectTo: search.redirect } : {})}
      onAuthenticated={(target) => {
        // WR-04: never navigate a raw search param.
        void router.navigate({ to: safeRedirectTarget(target) });
      }}
    />
  );
}
