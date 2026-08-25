import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionState } from "../lib/session-seam";

// OWNERSHIP: this stub is REPLACED by plan 03-07 (S4 Businesses admin CRUD -
// sectioned business sheet, logo upload, archive/restore).
function BusinessesStub() {
  return (
    <section aria-label="Businesses">
      <h1>Businesses</h1>
    </section>
  );
}

export const Route = createFileRoute("/businesses")({
  beforeLoad: () => {
    if (getSessionState() !== "authenticated") throw redirect({ to: "/login" });
  },
  component: BusinessesStub,
});
