// Global auth-failure interceptor (D-72/T-3-12): post-hoc taxonomy routing.
//
// A killed/expired session routes to /login?reason=… derived ONLY from the
// user's OWN profile probe - locked_at -> locked, !is_active -> deactivated,
// otherwise ended. Sign-in responses never carry these signals (T-3-08).
//
// Explicit local signOut MUST NOT trigger the interceptor (no self-redirect
// loops): the provider wraps signOutLocal in withAuthFailureSuppressed.

import {
  classifySessionEnd,
  observeAuthFailures,
  type SessionEndReason,
} from "@billing/api/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OwnProfileRow {
  locked_at: string | null;
  is_active: boolean;
}

export interface InterceptorOptions {
  /** Injectable own-profile probe (tests script outcomes). */
  getProfile?: () => Promise<OwnProfileRow | null>;
}

let suppressionDepth = 0;

/**
 * Run `fn` with interceptor reactions suppressed. Covers BOTH the awaited
 * sign-out call AND the local SIGNED_OUT echo auth-js emits during it.
 */
export async function withAuthFailureSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  suppressionDepth += 1;
  try {
    return await fn();
  } finally {
    suppressionDepth -= 1;
  }
}

async function fetchOwnProfile(client: SupabaseClient): Promise<OwnProfileRow | null> {
  try {
    const { data } = await client.auth.getUser();
    if (!data.user) return null;
    const res = await client
      .from("profiles")
      .select("locked_at,is_active")
      .eq("id", data.user.id)
      .maybeSingle();
    return (res.data as OwnProfileRow | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Start mirroring auth failures. Returns a stop function.
 * Re-entrant events are coalesced while a probe is in flight.
 */
export function startAuthFailureInterceptor(
  client: SupabaseClient,
  onFailure: (reason: SessionEndReason) => void,
  options: InterceptorOptions = {},
): () => void {
  let probing = false;
  return observeAuthFailures(client, () => {
    if (suppressionDepth > 0 || probing) return;
    probing = true;
    void (async () => {
      try {
        const profile = await (options.getProfile
          ? options.getProfile()
          : fetchOwnProfile(client));
        onFailure(profile ? classifySessionEnd(profile) : "ended");
      } catch {
        onFailure("ended");
      } finally {
        probing = false;
      }
    })();
  });
}
