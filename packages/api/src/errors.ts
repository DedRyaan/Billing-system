// Shared security-critical constants + the loud denial taxonomy (D-75).
//
// GENERIC_CREDENTIALS_ERROR_BODY is THE credential-failure copy: it must stay
// byte-identical to the auth-sign-in Edge Function's body (UI-SPEC Risk 2,
// T-1-27/T-3-04). test/errors.test.ts imports the REAL function source and
// proves equality over the wire shape - never re-type this copy anywhere.

export const GENERIC_CREDENTIALS_ERROR_BODY = {
  error: { code: "invalid_credentials", message: "Invalid email or password." },
} as const;

export type GenericCredentialsErrorCode = (typeof GENERIC_CREDENTIALS_ERROR_BODY)["error"]["code"];
export type GenericCredentialsMessage = (typeof GENERIC_CREDENTIALS_ERROR_BODY)["error"]["message"];

/** The user-facing message alone, for surfaces rendering just text. */
export const GENERIC_CREDENTIALS_MESSAGE: GenericCredentialsMessage =
  GENERIC_CREDENTIALS_ERROR_BODY.error.message;

// ---------------------------------------------------------------------------
// DataAccessError - every PostgREST/Postgres denial becomes data (D-75).
// Screens branch on `reason`; codes ride along loudly instead of being
// swallowed into generic strings.
// ---------------------------------------------------------------------------

export type DataAccessError =
  | { reason: "ROW_NOT_FOUND"; message: string }
  | { reason: "PERMISSION_DENIED"; message: string; pgCode: string }
  | { reason: "VALIDATION_FAILED"; message: string; pgCode: string }
  | { reason: "NETWORK"; message: string }
  | { reason: "UNKNOWN"; message: string; code?: string };

/** Minimal structural view of supabase-js PostgrestError we rely on. */
interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

function isPostgrestLike(err: unknown): err is PostgrestLikeError {
  // Real supabase-js PostgREST failures are PLAIN objects carrying code/
  // status; native Error instances (TypeError from fetch, etc.) must fall
  // through to the name/message mapping below.
  return (
    typeof err === "object" &&
    err !== null &&
    !(err instanceof Error) &&
    !Array.isArray(err) &&
    ("code" in err || "status" in err)
  );
}

/** Integrity/validation-class Postgres codes mapped to VALIDATION_FAILED. */
const VALIDATION_PG_CODES = new Set([
  "23000", // integrity_constraint_violation
  "23001", // restrict_violation
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23505", // unique_violation
  "23514", // check_violation
  "22P02", // invalid_text_representation (bad enum/format input)
]);

const NETWORK_MESSAGE_PATTERNS = [
  "failed to fetch",
  "fetch failed",
  "networkerror",
  "network request failed",
  "load failed",
];

/**
 * Map any thrown/failure value into the typed union. Never swallows a code:
 * unknown Postgres/PGRST codes pass through verbatim on UNKNOWN.
 */
export function toDataAccessError(err: unknown): DataAccessError {
  if (isPostgrestLike(err)) {
    const message = err.message ?? "Request failed.";
    const code = typeof err.code === "string" ? err.code : undefined;

    if (code === "42501") {
      return { reason: "PERMISSION_DENIED", message, pgCode: code };
    }
    if (code === "PGRST116" || code === "PGRST103") {
      // .single() zero/multiple rows; range offset issues -> row-level misses
      return { reason: "ROW_NOT_FOUND", message };
    }
    if (VALIDATION_PG_CODES.has(code ?? "")) {
      return { reason: "VALIDATION_FAILED", message, pgCode: code as string };
    }
    if (code === undefined && typeof (err as { status?: number }).status === "number") {
      const status = (err as { status: number }).status;
      if (status === 401 || status === 403) {
        return { reason: "PERMISSION_DENIED", message, pgCode: String(status) };
      }
      if (status >= 500 || status === 408) {
        return { reason: "NETWORK", message };
      }
    }
    return { reason: "UNKNOWN", message, ...(code !== undefined ? { code } : {}) };
  }

  if (err instanceof Error) {
    const haystack = `${err.name} ${err.message}`.toLowerCase();
    if (NETWORK_MESSAGE_PATTERNS.some((p) => haystack.includes(p))) {
      return { reason: "NETWORK", message: err.message };
    }
    return { reason: "UNKNOWN", message: err.message };
  }

  return { reason: "UNKNOWN", message: String(err) };
}
