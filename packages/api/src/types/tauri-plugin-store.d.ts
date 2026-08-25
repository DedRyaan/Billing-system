// Ambient declaration for the dynamic @tauri-apps/plugin-store import.
//
// packages/api deliberately does NOT install the plugin (the desktop app
// owns that dependency; this package must stay registry-frozen). The import
// only EXECUTES inside Tauri at runtime; here we declare just the surface
// the adapter consumes. Inside apps/desktop, vite resolves the real package
// with its own richer types.

declare module "@tauri-apps/plugin-store" {
  export interface Store {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    save(): Promise<void>;
  }
  export function load(
    path: string,
    options?: { autoSave?: boolean },
  ): Promise<Store>;
}
