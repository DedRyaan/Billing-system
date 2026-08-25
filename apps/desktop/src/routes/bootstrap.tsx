import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { BootstrapScreen } from "../screens/bootstrap/BootstrapScreen";
import { getBootstrapState } from "../lib/session-seam";
import { useAuth } from "../auth/AuthProvider";

// S2 First-run bootstrap - full-fidelity screen replacing the tracer stub
// (plan 03-03). Reachability is D-73-enforced: pre-bootstrap this is THE
// destination; post-bootstrap it redirects away forever.
export const Route = createFileRoute("/bootstrap")({
  beforeLoad: () => {
    if (getBootstrapState() === "bootstrapped") throw redirect({ to: "/" });
  },
  component: BootstrapPage,
});

function BootstrapPage() {
  const router = useRouter();
  const { invokeFunction, adoptReturnedSession } = useAuth();
  return (
    <BootstrapScreen
      invoke={invokeFunction}
      adoptSession={adoptReturnedSession}
      onBootstrapped={() => {
        // Fresh install has zero businesses - that empty state IS the welcome mat.
        void router.navigate({ to: "/businesses" });
      }}
    />
  );
}
