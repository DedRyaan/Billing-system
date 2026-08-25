// Session persistence seam implementations (plan 03-03, D-70/AUTH-01).
//
// Inside Tauri: tauri-plugin-store file-backed storage survives restarts.
// Outside Tauri (browser/dev): NotInTauriError -> callers fall back to the
// localStorage adapter, which stays the dev default per D-70.

import type { SupportedStorage } from "@supabase/supabase-js";
import { storageAdapter } from "./storage-adapter";

export class NotInTauriError extends Error {
  constructor() {
    super("Not running inside Tauri - use the localStorage dev adapter instead.");
    this.name = "NotInTauriError";
  }
}

/** Structural subset of tauri-plugin-store's Store the adapter consumes. */
interface StoreLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  save(): Promise<void>;
}

export interface TauriStoreStorageOptions {
  storeName?: string;
  /**
   * Injectable loader (tests pass an in-memory Store double). Defaults to a
   * dynamic import of @tauri-apps/plugin-store executed ONLY when actually
   * inside Tauri.
   */
  loader?: () => Promise<StoreLike>;
}

const DEFAULT_STORE_NAME = "billing-session.json";

async function defaultLoader(storeName: string): Promise<StoreLike> {
  // Structural adaptation of the real plugin-store module onto StoreLike;
  // `unknown` bridge because the plugin's concrete Store class carries
  // richer member signatures than this package's minimal seam.
  const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
    load: (path: string, options?: { autoSave?: boolean }) => Promise<StoreLike>;
  };
  return mod.load(storeName, { autoSave: false });
}

function isInsideTauri(): boolean {
  return (
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined"
  );
}

function coerceToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Create the Tauri store-backed SupportedStorage adapter. Throws
 * NotInTauriError outside Tauri so callers can fall back cleanly.
 */
export async function createTauriStoreStorage(
  options: TauriStoreStorageOptions = {},
): Promise<SupportedStorage> {
  // An injected loader stands in for the Tauri runtime (tests); only the
  // default dynamic-import path requires the real internals.
  if (!options.loader && !isInsideTauri()) throw new NotInTauriError();

  const loader = options.loader ?? (() => defaultLoader(options.storeName ?? DEFAULT_STORE_NAME));
  const store = await loader();

  return {
    getItem: async (key) => coerceToString(await store.get(key)),
    setItem: async (key, value) => {
      await store.set(key, value);
      await store.save().catch(() => undefined);
    },
    removeItem: async (key) => {
      await store.delete(key);
      await store.save().catch(() => undefined);
    },
  };
}

/**
 * Convenience resolver (D-70): Tauri-backed when available, localStorage
 * dev adapter otherwise. Never rejects.
 */
export async function resolveSessionStorage(): Promise<SupportedStorage> {
  try {
    return await createTauriStoreStorage();
  } catch (err) {
    if (!(err instanceof NotInTauriError)) {
      // A genuine store failure inside Tauri still falls back rather than
      // bricking startup; sessions then live in webview-localStorage.
      console.error("tauri store unavailable, falling back to localStorage:", err);
    }
    return storageAdapter;
  }
}
