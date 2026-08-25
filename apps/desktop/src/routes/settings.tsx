import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionState } from "../lib/session-seam";

// OWNERSHIP: this stub is REPLACED by plan 03-10 (S8 Settings assembly +
// S7 Team & memberships for admins).
function SettingsStub() {
  return (
    <section aria-label="Settings">
      <h1>Settings</h1>
    </section>
  );
}

export const Route = createFileRoute("/settings")({
  beforeLoad: () => {
    if (getSessionState() !== "authenticated") throw redirect({ to: "/login" });
  },
  component: SettingsStub,
});
