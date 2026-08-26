// ui-prefs - cosmetic shell-state persistence (plan 03-06; T-3-22 boundary).
//
// ONLY ever stores presentation state (rail collapsed, etc.) - NEVER
// authorization-relevant data. localStorage is the synchronous source of
// truth (instant first paint in every runtime, including the Tauri webview
// where it persists per app install); when running inside Tauri a
// fire-and-forget mirror into tauri-plugin-store keeps prefs durable even if
// webview storage is cleared. Tampered values degrade to booleans safely.
//
// Tests inject an in-memory backend via setPrefsBackend().

const SIDEBAR_COLLAPSED_KEY = "ui.sidebar.collapsed";

export interface PrefsBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let backendOverride: PrefsBackend | null = null;

export function setPrefsBackend(backend: PrefsBackend | null): void {
  backendOverride = backend;
}

function resolveBackend(): PrefsBackend | null {
  if (backendOverride !== null) return backendOverride;
  // jsdom/SSR safety: window.localStorage may be unavailable.
  try {
    return globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

function isInsideTauri(): boolean {
  return (
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined"
  );
}

/** Fire-and-forget Tauri store mirror; silently absent outside Tauri. */
async function mirrorWrite(key: string, value: string): Promise<void> {
  if (!isInsideTauri()) return;
  try {
    const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
      load: (path: string, options?: { autoSave?: boolean }) => Promise<{
        set(key: string, value: unknown): Promise<void>;
        save(): Promise<void>;
      }>;
    };
    const store = await mod.load("ui-prefs.json", { autoSave: false });
    await store.set(key, value);
    await store.save();
  } catch {
    // Cosmetic pref - mirror failure is never surfaced.
  }
}

export function readSidebarCollapsed(): boolean {
  return resolveBackend()?.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  const value = collapsed ? "1" : "0";
  resolveBackend()?.setItem(SIDEBAR_COLLAPSED_KEY, value);
  void mirrorWrite(SIDEBAR_COLLAPSED_KEY, value);
}
