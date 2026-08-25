import { createFileRoute } from "@tanstack/react-router";

// OWNERSHIP: this stub is REPLACED by plan 03-03 (S1 Sign-in screen, full
// fidelity per UI-SPEC S1 + auth wiring).
function LoginStub() {
  return (
    <main aria-label="Sign in">
      <h1>Sign in</h1>
    </main>
  );
}

export const Route = createFileRoute("/login")({
  component: LoginStub,
});
