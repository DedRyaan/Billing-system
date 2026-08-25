// Auth branch seam for the route guards (tracer slice + plan 03-03).
//
// The real session provider lives in src/auth/AuthProvider.tsx; this module
// is the synchronous source the beforeLoad guards consult. It lives OUTSIDE
// React on purpose: TanStack Router's beforeLoad runs outside component
// scope, so the provider syncs state in and routes read it immediately.

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

/**
 * First-run bootstrap truth (D-73): 'unknown' while the probe is pending,
 * 'unbootstrapped' while zero profiles exist (forces /bootstrap instead of
 * everything), 'bootstrapped' forever after the owner account is minted.
 */
export type BootstrapState = "unknown" | "bootstrapped" | "unbootstrapped";

let bootstrap: BootstrapState = "unknown";

export function getBootstrapState(): BootstrapState {
  return bootstrap;
}

export function setBootstrapState(next: BootstrapState): void {
  bootstrap = next;
}
