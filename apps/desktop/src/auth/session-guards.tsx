// Route guard helpers consumed by beforeLoad across the route tree
// (plan 03-03; the no-half-auth guarantee made structural).
import { redirect } from "@tanstack/react-router";
import { getSessionState } from "../lib/session-seam";

/**
 * Protected-route guard preserving the intended destination so post-login
 * returns the user where they meant to go.
 */
export function requireAuthenticatedPreserving(currentPath: string): void {
  if (getSessionState() !== "authenticated") {
    throw redirect({ to: "/login", search: { redirect: currentPath } });
  }
}

/** Public-auth guard: authenticated users never see /login or /bootstrap. */
export function requireUnauthenticated(): void {
  if (getSessionState() === "authenticated") {
    throw redirect({ to: "/dashboard" });
  }
}
