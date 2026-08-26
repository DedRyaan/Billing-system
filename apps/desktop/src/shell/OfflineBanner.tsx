// OfflineBanner + useOnlineStatus (D-82): a slim warning bar rendered at the
// top of the content pane while offline; reads serve from cache, mutation
// CTAs disable with OFFLINE_CTA_TOOLTIP. NO offline queue exists in v1 -
// online-first is an explicit fence.
//
// The connectivity store is a framework-free singleton over online/offline
// events so screens can consume useOnlineStatus() independently of the
// banner's presence.
import { useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";
import { OFFLINE_BANNER } from "../lib/strings/global";
import { OFFLINE_CTA_TOOLTIP } from "../lib/strings/shell";

export { OFFLINE_CTA_TOOLTIP };

function subscribe(fn: () => void): () => void {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

function snapshot(): boolean {
  // jsdom and older webviews: navigator.onLine may be undefined -> assume online.
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function getServerSnapshot(): boolean {
  return true;
}

/** True when the browser/webview reports connectivity. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, snapshot, getServerSnapshot);
}

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="flex shrink-0 items-center gap-sm bg-warning-subtle px-lg py-xs text-caption text-warning"
    >
      <TriangleAlert size={14} aria-hidden="true" />
      {OFFLINE_BANNER}
    </div>
  );
}
