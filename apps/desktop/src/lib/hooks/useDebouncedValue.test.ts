// useDebouncedValue - stable timer semantics under rapid re-renders.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebouncedValue", () => {
  it("returns the initial value immediately, then debounces changes", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: "a" },
    });
    expect(result.current[0]).toBe("a");

    rerender({ v: "ab" });
    rerender({ v: "abc" });
    act(() => vi.advanceTimersByTime(150));
    expect(result.current[0]).toBe("a"); // timer keeps resetting

    act(() => vi.advanceTimersByTime(250));
    expect(result.current[0]).toBe("abc");
  });

  it("cleans up its timer on unmount (no late setState)", () => {
    const { result, rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: "x" },
    });
    rerender({ v: "y" });
    unmount();
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(result.current[0]).toBe("x");
  });
});
