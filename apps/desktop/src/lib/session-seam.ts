// Auth branch seam for the route guards (tracer slice).
//
// The real session provider lands in plan 03-03; until then this module is
// the single source the beforeLoad guards consult. It lives OUTSIDE React on
// purpose: TanStack Router's beforeLoad runs outside component scope, so the
// provider syncs state in via setSessionState and routes read it
// synchronously.

export type SessionState = "unauthenticated" | "authenticated";

let current: SessionState = "unauthenticated";
const listeners = new Set<(state: SessionState) => void>();

export function getSessionState(): SessionState {
  return current;
}

export function setSessionState(next: SessionState): void {
  if (current === next) return;
  current = next;
  for (const notify of listeners) notify(next);
}

export function subscribeSession(fn: (state: SessionState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
