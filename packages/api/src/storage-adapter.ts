import type { SupportedStorage } from "@supabase/supabase-js";

// Session-persistence seam (A7): the web/localStorage-backed implementation is
// the dev default. Phase 3 swaps in a Tauri store implementation behind this
// same SupportedStorage contract without architectural change.
export const storageAdapter: SupportedStorage = {
  getItem: (key) => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  removeItem: (key) => globalThis.localStorage.removeItem(key),
};
