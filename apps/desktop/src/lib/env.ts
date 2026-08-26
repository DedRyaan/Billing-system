// App-owned env parsing (T-3-05): the ONLY place VITE_* vars are read.
// Fail-fast on missing values; refuses unknown SUPABASE_* keys so a stray
// service-role var can never ride into the bundle unnoticed.
// The anon key is public-by-design (RLS is the boundary); service-role
// material must never appear here.

export interface BillingEnv {
  url: string;
  anonKey: string;
}

const ALLOWED_SUPABASE_KEYS = new Set(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);

export class BillingEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingEnvError";
  }
}

export function readBillingEnv(record: Record<string, unknown>): BillingEnv {
  for (const key of Object.keys(record)) {
    if (/^VITE_SUPABASE_/i.test(key) && !ALLOWED_SUPABASE_KEYS.has(key)) {
      throw new BillingEnvError(
        `Unknown Supabase env var "${key}" - only VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are recognized.`,
      );
    }
  }

  const url = record["VITE_SUPABASE_URL"];
  const anonKey = record["VITE_SUPABASE_ANON_KEY"];
  if (typeof url !== "string" || url.length === 0) {
    throw new BillingEnvError("VITE_SUPABASE_URL is missing - the app cannot reach Supabase.");
  }
  if (typeof anonKey !== "string" || anonKey.length === 0) {
    throw new BillingEnvError("VITE_SUPABASE_ANON_KEY is missing - the app cannot reach Supabase.");
  }
  return { url, anonKey };
}

/** Lookup client config composed by the customers screen (MSTR-03/D-76). */
export interface GstinLookupEnvConfig {
  baseUrl: string;
  apiKeyHeader?: { name: string; value: string };
}

/**
 * Optional GSTIN auto-fetch wiring (CR-02): VITE_GSTIN_LOOKUP_URL present
 * turns the feature on; anything else returns null and the caller keeps the
 * machine disabled. NEVER throws - this feature must not be able to break
 * app boot the way a missing Supabase env must. The key rides as x-api-key.
 */
export function readGstinLookupEnv(record: Record<string, unknown>): GstinLookupEnvConfig | null {
  const url = record["VITE_GSTIN_LOOKUP_URL"];
  if (typeof url !== "string" || url.trim().length === 0) return null;
  const key = record["VITE_GSTIN_LOOKUP_API_KEY"];
  return {
    baseUrl: url,
    ...(typeof key === "string" && key.length > 0
      ? { apiKeyHeader: { name: "x-api-key", value: key } }
      : {}),
  };
}
