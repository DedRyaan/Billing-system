// toast-store contract tests (S9): stack cap 3, auto-dismiss timers (5s /
// errors 8s), pub/sub notifications, action+close dismissal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentToasts,
  dismissToast,
  resetToasts,
  showToast,
  subscribeToasts,
} from "./toast-store";

beforeEach(() => {
  vi.useFakeTimers();
  resetToasts();
});
afterEach(() => {
  resetToasts();
  vi.useRealTimers();
});

describe("toast-store", () => {
  it("stacks toasts and evicts oldest beyond cap of 3", () => {
    showToast({ message: "one" });
    showToast({ message: "two" });
    showToast({ message: "three" });
    const four = showToast({ message: "four" });
    expect(currentToasts().length).toBe(3);
    expect(currentToasts().map((t) => t.message)).toEqual(["two", "three", "four"]);
    void four;
  });

  it("auto-dismisses info toasts after 5s and errors after 8s", () => {
    showToast({ message: "info-one" });
    showToast({ variant: "error", message: "err-one" });
    vi.advanceTimersByTime(5000);
    expect(currentToasts().map((t) => t.message)).toEqual(["err-one"]);
    vi.advanceTimersByTime(3000);
    expect(currentToasts().length).toBe(0);
  });

  it("manual dismissal cancels the pending timer", () => {
    const id = showToast({ message: "held" });
    dismissToast(id);
    vi.advanceTimersByTime(10_000);
    expect(currentToasts().length).toBe(0);
  });

  it("notifies subscribers with snapshots; unsubscribe stops notifications", () => {
    const seen: number[] = [];
    const unsub = subscribeToasts((t) => seen.push(t.length));
    showToast({ message: "a" });
    showToast({ message: "b" });
    unsub();
    showToast({ message: "c" });
    expect(seen).toEqual([1, 2]);
  });

  it("action button payload rides along for Retry-style flows", () => {
    const onAction = vi.fn();
    const id = showToast({ message: "failed", actionLabel: "Retry", onAction });
    const toast = currentToasts().find((t) => t.id === id);
    expect(toast?.actionLabel).toBe("Retry");
    toast?.onAction?.();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
