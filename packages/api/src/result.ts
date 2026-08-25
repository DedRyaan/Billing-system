// Result<T> envelope: every data-access outcome is DATA (D-75/D-82) - the UI
// branches on ok/error instead of catching. RLS denials ride through
// toDataAccessError with their Postgres codes intact.
import { toDataAccessError, type DataAccessError } from "./errors";

export type Result<T> = { ok: true; data: T } | { ok: false; error: DataAccessError };

interface PostgrestEnvelope<T> {
  data: T;
  error: DataAccessError extends never ? never : unknown;
}

/** Await a supabase-js query promise and map it into the typed envelope. */
export async function fromPostgrest<T>(
  query: PromiseLike<PostgrestEnvelope<T>>,
): Promise<Result<T>> {
  const { data, error } = await query;
  if (error) {
    return { ok: false, error: toDataAccessError(error) };
  }
  return { ok: true, data };
}

/** Map an RPC/other raw failure value directly. */
export function asError(err: unknown): DataAccessError {
  return toDataAccessError(err);
}
