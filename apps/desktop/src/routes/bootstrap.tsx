import { createFileRoute } from "@tanstack/react-router";

// OWNERSHIP: this stub is REPLACED by plan 03-03 (S2 first-run bootstrap
// screen wired to bootstrap-super-admin; D-73 probe gate).
function BootstrapStub() {
  return (
    <main aria-label="Set up your workspace">
      <h1>Set up your workspace</h1>
    </main>
  );
}

export const Route = createFileRoute("/bootstrap")({
  component: BootstrapStub,
});
