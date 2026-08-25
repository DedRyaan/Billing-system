import { createClient, type SupabaseClient, type SupportedStorage } from "@supabase/supabase-js";
import type { Database } from "@billing/db-types";
import { storageAdapter } from "./storage-adapter";

// The single door to Supabase (D-79). Every screen composes domain modules
// from this package; nothing outside constructs its own supabase client.

/** Parsed app env - the desktop app owns parsing; this package consumes values. */
export interface BillingEnv {
  url: string;
  anonKey: string;
}

/**
 * Typed fail-fast error for a missing/empty env value. Thrown at client
 * construction - never a silent misconfigured runtime.
 */
export class BillingConfigError extends Error {
  readonly field: "url" | "anonKey";
  constructor(field: "url" | "anonKey") {
    super(`BillingEnv.${field} is empty - the Supabase client cannot be constructed.`);
    this.name = "BillingConfigError";
    this.field = field;
  }
}

export interface CreateBillingClientOptions {
  /**
   * Session-persistence seam (A7/D-70). Defaults to the localStorage adapter
   * for dev/browser; the desktop shell passes the Tauri store-backed adapter.
   */
  storage?: SupportedStorage;
}

/**
 * Construct the app's one and only Supabase client, typed against the
 * regenerated live schema. Fails fast on empty config values.
 */
export function createBillingClient(
  env: BillingEnv,
  opts?: CreateBillingClientOptions,
): SupabaseClient<Database> {
  if (!env.url) throw new BillingConfigError("url");
  if (!env.anonKey) throw new BillingConfigError("anonKey");
  return createClient<Database>(env.url, env.anonKey, {
    auth: {
      storage: opts?.storage ?? storageAdapter,
      autoRefreshToken: true,
      persistSession: true,
    },
  });
}

// Re-exported unchanged so consumers have one import site; the localStorage
// default stays the dev default per D-70.
export { storageAdapter };
