// settle:// deep links (email sign-in and password-reset links).
//
// Windows starts the app with the URL when it is closed; when it is already
// running, single-instance forwards the URL and onOpenUrl fires. Outside the
// Tauri shell (browser dev, tests) this is a no-op.

let launchUrlsHandled = false;

function inTauri(): boolean {
  return (
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined"
  );
}

/** Subscribe to incoming settle:// URLs. Returns an unsubscribe function. */
export async function listenForDeepLinks(onUrl: (url: string) => void): Promise<() => void> {
  if (!inTauri()) return () => undefined;
  try {
    const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
    const unlisten = await onOpenUrl((urls) => urls.forEach(onUrl));
    // The URL the app was launched with is handed over once per run -
    // getCurrent keeps returning it, so never replay it on re-subscribe.
    if (!launchUrlsHandled) {
      launchUrlsHandled = true;
      const launch = await getCurrent();
      launch?.forEach(onUrl);
    }
    return unlisten;
  } catch {
    return () => undefined;
  }
}
