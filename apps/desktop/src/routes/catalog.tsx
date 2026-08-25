import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionState } from "../lib/session-seam";

// OWNERSHIP: this stub is REPLACED by plan 03-09 (S6 Catalog CRUD - slab-law
// options, admin edit / staff read-only mirror per D-75).
function CatalogStub() {
  return (
    <section aria-label="Catalog">
      <h1>Catalog</h1>
    </section>
  );
}

export const Route = createFileRoute("/catalog")({
  beforeLoad: () => {
    if (getSessionState() !== "authenticated") throw redirect({ to: "/login" });
  },
  component: CatalogStub,
});
