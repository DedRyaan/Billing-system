import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionState } from "../lib/session-seam";

// Placeholder per UI-SPEC Copywriting table (exact copy). Phase 4 replaces
// this with bill drafting - the shell never restructures (D-66).
function BillsPlaceholder() {
  return (
    <section aria-label="Bills placeholder">
      <h1>Bills</h1>
      <p>Bill drafting arrives next — blank screen to final number in under 30 seconds.</p>
    </section>
  );
}

export const Route = createFileRoute("/bills")({
  beforeLoad: () => {
    if (getSessionState() !== "authenticated") throw redirect({ to: "/login" });
  },
  component: BillsPlaceholder,
});
