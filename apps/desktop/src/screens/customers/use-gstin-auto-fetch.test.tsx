// useGstinAutoFetch machine contracts (plan 03-08 Task 1, MSTR-03/D-76/T-3-29).
//
// THE invariants proven here:
//   - last-input-wins: a stale resolution can never land after an edit;
//   - zero network for empty/structurally-invalid input;
//   - exactly one in-flight request per settled input;
//   - disabled config pins the machine regardless of validity;
//   - cache-seeded construction renders verified WITHOUT refetching;
//   - mergePrefill never overwrites a field the user has edited.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useGstinAutoFetch,
  mergePrefill,
  type AutoFetchOutcome,
} from "./useGstinAutoFetch";

const VALID_GSTIN = "27AAPFU0939F1ZV";

/** Scriptable deferred lookup: tests resolve/reject manually. */
function scriptedLookup() {
  const calls: string[] = [];
  const pending: Array<{
    gstin: string;
    resolve: (o: AutoFetchOutcome) => void;
  }> = [];
  const fn = vi.fn((gstin: string) => {
    calls.push(gstin);
    return new Promise<AutoFetchOutcome>((resolve) => {
      pending.push({ gstin, resolve });
    });
  });
  return {
    fn,
    calls,
    settleLast(outcome: AutoFetchOutcome) {
      const p = pending.pop();
      if (p !== undefined) p.resolve(outcome);
    },
    pendingCount: () => pending.length,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function renderMachine(
  deps: Parameters<typeof useGstinAutoFetch>[0],
  initialGstin: string,
  seed?: Record<string, unknown>,
) {
  return renderHook(
    ({ gstin }: { gstin: string }) => useGstinAutoFetch(deps, gstin, seed),
    { initialProps: { gstin: initialGstin } },
  );
}

describe("input gating", () => {
  it("empty input idles immediately - zero network", async () => {
    const lookup = scriptedLookup();
    const { result } = renderMachine({ lookup: lookup.fn }, "");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current.state.status).toBe("idle");
    expect(lookup.calls.length).toBe(0);
  });

  it("invalid structure idles immediately - zero network", async () => {
    const lookup = scriptedLookup();
    const { result } = renderMachine({ lookup: lookup.fn }, "27AAPFU0939F1");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current.state.status).toBe("idle");
    expect(lookup.calls.length).toBe(0);
  });

  it("valid input debounces 600ms before checking fires", async () => {
    const lookup = scriptedLookup();
    const { result } = renderMachine({ lookup: lookup.fn }, VALID_GSTIN);
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(lookup.calls.length).toBe(0);
    expect(result.current.state.status).toBe("idle");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(lookup.calls).toEqual([VALID_GSTIN]);
    expect(result.current.state.status).toBe("checking");
  });
});

describe("outcome mapping", () => {
  it("verified outcome carries normalized prefill", async () => {
    const lookup = scriptedLookup();
    const { result } = renderMachine({ lookup: lookup.fn }, VALID_GSTIN);
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      lookup.settleLast({
        outcome: "verified",
        payload: {
          legalName: "Alpha Traders Pvt Ltd",
          registeredAddress: {
            lines: ["12 MG Road", "Near Market"],
            city: "Pune",
            stateCode: "27",
            pincode: "411001",
          },
        },
      });
    });
    expect(result.current.state.status).toBe("verified");
    if (result.current.state.status === "verified") {
      expect(result.current.state.prefill.legalName).toBe("Alpha Traders Pvt Ltd");
      expect(result.current.state.prefill.address?.city).toBe("Pune");
    }
  });

  it.each([
    { label: "not_found", outcome: { outcome: "not_found" } as AutoFetchOutcome },
    { label: "failed-network", outcome: { outcome: "failed", reason: "network" } as AutoFetchOutcome },
    { label: "failed-timeout", outcome: { outcome: "failed", reason: "timeout" } as AutoFetchOutcome },
  ])("$label degrades to the muted fallback", async ({ outcome }) => {
    const lookup = scriptedLookup();
    const { result } = renderMachine({ lookup: lookup.fn }, VALID_GSTIN);
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {
      lookup.settleLast(outcome);
    });
    expect(result.current.state.status).toBe("fallback");
  });
});

describe("last-input-wins (T-3-29)", () => {
  it("an edit during flight discards the stale resolution entirely", async () => {
    const lookup = scriptedLookup();
    const { result, rerender } = renderMachine({ lookup: lookup.fn }, VALID_GSTIN);
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(lookup.calls.length).toBe(1);

    // Edit BEFORE the first resolution lands.
    rerender({ gstin: "33AAACC1206D1ZN" });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    // Second request now in flight; resolve BOTH - stale one must lose.
    await act(async () => {
      lookup.settleLast({ outcome: "verified", payload: { legalName: "OLD NAME" } }); // resolves newest? pop() takes last
    });
    // Resolve remaining (the FIRST request's late answer).
    await act(async () => {
      lookup.settleLast({ outcome: "verified", payload: { legalName: "STALE MUST NOT LAND" } });
    });

    // The visible prefill belongs to the LATEST input, not the stale one.
    expect(result.current.state.status).toBe("verified");
    if (result.current.state.status === "verified") {
      expect(result.current.state.prefill.legalName).not.toBe("STALE MUST NOT LAND");
    }
    expect(lookup.calls.length).toBe(2);
  });

  it("editing back to invalid drops to idle and cancels the pending timer", async () => {
    const lookup = scriptedLookup();
    const { result, rerender } = renderMachine({ lookup: lookup.fn }, VALID_GSTIN);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender({ gstin: "27AAPF" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.state.status).toBe("idle");
    expect(lookup.calls.length).toBe(0);
  });
});

describe("disabled config", () => {
  it("pins the machine regardless of input validity - zero calls ever", async () => {
    const lookup = scriptedLookup();
    const { result, rerender } = renderMachine({ lookup: lookup.fn, enabled: false }, VALID_GSTIN);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.state.status).toBe("disabled");
    rerender({ gstin: "" });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(lookup.calls.length).toBe(0);
  });
});

describe("cache-seeded constructor", () => {
  it("renders verified WITHOUT any refetch when a row snapshot exists", async () => {
    const lookup = scriptedLookup();
    const { result } = renderMachine(
      { lookup: lookup.fn },
      VALID_GSTIN,
      {
        legalName: "Cached Traders",
        fetchedAt: "2026-01-01",
        registeredAddress: { lines: ["Old Street"], city: "Nashik", stateCode: "27" },
      },
    );
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.state.status).toBe("verified");
    if (result.current.state.status === "verified") {
      expect(result.current.state.prefill.legalName).toBe("Cached Traders");
    }
    expect(lookup.calls.length).toBe(0);
  });

  it("seeded verified state still re-checks when the user edits the GSTIN", async () => {
    const lookup = scriptedLookup();
    const { rerender } = renderMachine({ lookup: lookup.fn }, VALID_GSTIN, {
      legalName: "Cached",
    });
    rerender({ gstin: "33AAACC1206D1ZN" });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(lookup.calls.length).toBe(1);
  });
});

describe("mergePrefill dirty-field guard", () => {
  const draft = {
    legal_name: "",
    address_text: "",
    city: "",
    pincode: "",
    state_code: "",
  };
  const prefill = {
    legalName: "Registry Name",
    address: { lines: ["A Line"], city: "Registry City", stateCode: "27", pincode: "411001" },
  };

  it("fills every untouched field", () => {
    const merged = mergePrefill(draft, new Set(), prefill);
    expect(merged.legal_name).toBe("Registry Name");
    expect(merged.city).toBe("Registry City");
    expect(merged.address_text).toBe("A Line");
    expect(merged.pincode).toBe("411001");
    expect(merged.state_code).toBe("27");
  });

  it("never overwrites a field the user has since edited", () => {
    const merged = mergePrefill(
      { ...draft, legal_name: "User Typed First" },
      new Set(["legal_name"]),
      prefill,
    );
    expect(merged.legal_name).toBe("User Typed First");
    expect(merged.city).toBe("Registry City"); // others still fill
  });
});
