// CacheJanitor (WR-02): tenant-scoped query entries must never survive an
// identity END. signOut and the auth-failure interceptor both flip the
// provider phase to "unauthenticated" - this component watches for that
// transition and drops the ENTIRE in-memory cache, so a different user (or a
// re-login of the same one) can never render rows fetched under a previous
// identity, even stale-while-revalidate ghosts.
//
// Mounted inside BOTH providers (main.tsx + the test render harness). Renders
// nothing; transitions restoring->unauthenticated are a no-op on an empty
// cache, and unauthenticated->unauthenticated repeats never re-clear.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";

export function CacheJanitor(): null {
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const prevStatus = useRef(status);

  useEffect(() => {
    if (
      prevStatus.current === "authenticated" &&
      status === "unauthenticated"
    ) {
      // Identity end: sign-out or forced session termination.
      queryClient.clear();
    }
    prevStatus.current = status;
  }, [status, queryClient]);

  return null;
}
