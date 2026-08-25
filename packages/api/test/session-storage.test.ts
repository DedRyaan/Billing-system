// Session-storage adapter behaviors (plan 03-03 Task 1) - RED phase.
// Proves the Tauri store seam round-trips sessions across simulated restarts
// using an in-memory Store double. Zero Tauri runtime required.

import { describe, expect, it } from "vitest";
import {
  NotInTauriError,
  createTauriStoreStorage,
  resolveSessionStorage,
} from "../src/session-storage";

/** In-memory double of the plugin-store surface the adapter consumes. */
function memoryStoreDouble() {
  const backing = new Map<string, unknown>();
  const savedKeys: string[] = [];
  return {
    backing,
    savedKeys,
    store: {
      get: async (k: string) => backing.get(k),
      set: async (k: string, v: unknown) => {
        backing.set(k, v);
      },
      delete: async (k: string) => {
        backing.delete(k);
      },
      save: async () => {
        savedKeys.push("flushed");
      },
    },
  };
}

const LOADER = (double: ReturnType<typeof memoryStoreDouble>) => async () => double.store;

describe("createTauriStoreStorage", () => {
  it("throws NotInTauriError outside Tauri (no __TAURI_INTERNALS__)", async () => {
    await expect(createTauriStoreStorage()).rejects.toBeInstanceOf(NotInTauriError);
  });

  it("adapts Store get/set/delete onto SupportedStorage", async () => {
    const double = memoryStoreDouble();
    const storage = await createTauriStoreStorage({ loader: LOADER(double) });

    await storage.setItem("sb-test-auth-token", '{"access":"a"}');
    await expect(storage.getItem("sb-test-auth-token")).resolves.toBe('{"access":"a"}');
    await expect(storage.getItem("missing")).resolves.toBeNull();

    await storage.removeItem("sb-test-auth-token");
    await expect(storage.getItem("sb-test-auth-token")).resolves.toBeNull();
  });

  it("round-trips a session across a simulated restart (new instance reads old token)", async () => {
    const double = memoryStoreDouble();
    const firstDevice = await createTauriStoreStorage({ loader: LOADER(double) });

    const sessionJson = JSON.stringify({
      access_token: "at-old",
      refresh_token: "rt-old",
      user: { id: "u1" },
    });
    await firstDevice.setItem("sb-billing-auth-token", sessionJson);

    // Simulated restart: brand-new storage/client instance over the same
    // file-backed store.
    const restartedDevice = await createTauriStoreStorage({ loader: LOADER(double) });
    await expect(restartedDevice.getItem("sb-billing-auth-token")).resolves.toBe(sessionJson);
  });

  it("flushes to disk on write (save after set/remove)", async () => {
    const double = memoryStoreDouble();
    const storage = await createTauriStoreStorage({ loader: LOADER(double) });
    await storage.setItem("k", "v");
    await storage.removeItem("k");
    expect(double.savedKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("coerces non-string stored values to their string form", async () => {
    const double = memoryStoreDouble();
    double.backing.set("preexisting-object", { access_token: "x" });
    const storage = await createTauriStoreStorage({ loader: LOADER(double) });
    await expect(storage.getItem("preexisting-object")).resolves.toBe('{"access_token":"x"}');
  });
});

describe("resolveSessionStorage", () => {
  it("falls back to the localStorage adapter outside Tauri (dev default, D-70)", async () => {
    const resolved = await resolveSessionStorage();
    expect(typeof resolved.getItem).toBe("function");
  });
});
