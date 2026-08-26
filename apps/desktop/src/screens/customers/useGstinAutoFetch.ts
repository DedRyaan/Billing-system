// useGstinAutoFetch - the MSTR-03 auto-fetch state machine (plan 03-08, D-76).
//
//   idle ── valid structure held across a 600ms debounce ──▶ checking
//     ▲                                                        │
//     └────────── user edits GSTIN ────────────── verified │ not-found │ failed
//
// LAST-INPUT-WINS (T-3-29): every input change retires the previous request
// via a monotonic token; a late resolution for a retired token is dropped
// unconditionally, so stale prefills can never land after an edit.
// SILENT DEGRADATION: not_found/failed/disabled all land in one muted
// `fallback` state; timeout counts as failed; saving is NEVER blocked.
//
// CACHE SEED (D-76): constructing with a row's `_gstin_lookup` snapshot
// renders verified WITHOUT refetching - held while the input matches the
// seeded GSTIN; the first edit leaves the seed forever.
//
// The lookup function is injected (tests script outcomes; production composes
// fetchGstinParty with env config). Absent config (`enabled:false`) pins the
// machine to `disabled` regardless of input validity.
import { useEffect, useRef, useState } from "react";
import { validateGstin } from "@billing/gst";

const DEBOUNCE_MS = 600;

export interface PrefillAddress {
  lines: string[];
  city?: string;
  stateCode?: string;
  pincode?: string;
}

export interface Prefill {
  legalName: string;
  tradeName?: string;
  address?: PrefillAddress;
}

export type AutoFetchOutcome =
  | { outcome: "verified"; payload: NormalizedPayload }
  | { outcome: "not_found" }
  | { outcome: "failed"; reason?: string };

/** Structural shape produced by packages/api normalizePartyPayload. */
export interface NormalizedPayload {
  legalName: string;
  tradeName?: string;
  registeredAddress?: PrefillAddress;
}

/** Row-snapshot envelope convention (customers.address._gstin_lookup). */
export interface SeedSnapshot extends Partial<NormalizedPayload> {
  /** GSTIN the snapshot was fetched FOR - seeds match only this input. */
  gstin?: string;
  fetchedAt?: string;
}

export type AutoFetchState =
  | { status: "idle" }
  | { status: "disabled" }
  | { status: "checking" }
  | { status: "verified"; prefill: Prefill }
  | { status: "fallback"; reason: "not_found" | "failed" };

export interface UseGstinAutoFetchDeps {
  /** Injected best-effort lookup over the gstin-lookup client. */
  lookup: (gstin: string) => Promise<AutoFetchOutcome>;
  /** False when VITE_GSTIN_LOOKUP_URL absent - feature disabled entirely. */
  enabled?: boolean;
}

function prefillFromPayload(payload: NormalizedPayload): Prefill {
  return {
    legalName: payload.legalName,
    ...(payload.tradeName !== undefined ? { tradeName: payload.tradeName } : {}),
    ...(payload.registeredAddress !== undefined
      ? { address: payload.registeredAddress }
      : {}),
  };
}

/**
 * DIRTY-FIELD GUARD: apply a prefill to the customer draft touching ONLY
 * fields the user has not edited. Exported pure so interleaving tests prove
 * the guard without mounting React.
 */
export interface PrefillDraft {
  legal_name: string;
  address_text: string;
  city: string;
  pincode: string;
  state_code: string;
}

export function mergePrefill(
  draft: PrefillDraft,
  touched: ReadonlySet<string>,
  prefill: Prefill,
): PrefillDraft {
  const next = { ...draft };
  if (!touched.has("legal_name") && prefill.legalName.length > 0) {
    next.legal_name = prefill.legalName;
  }
  if (prefill.address !== undefined) {
    if (!touched.has("address_text") && prefill.address.lines.length > 0) {
      next.address_text = prefill.address.lines.join("\n");
    }
    if (!touched.has("city") && prefill.address.city !== undefined) {
      next.city = prefill.address.city;
    }
    if (!touched.has("pincode") && prefill.address.pincode !== undefined) {
      next.pincode = prefill.address.pincode;
    }
    if (!touched.has("state_code") && prefill.address.stateCode !== undefined) {
      next.state_code = prefill.address.stateCode;
    }
  }
  return next;
}

export function useGstinAutoFetch(
  deps: UseGstinAutoFetchDeps,
  gstinInput: string,
  seedSnapshot?: SeedSnapshot | null,
): { state: AutoFetchState } {
  const enabled = deps.enabled !== false && typeof deps.lookup === "function";
  const normalizedInitial = gstinInput.trim().toUpperCase();

  const [state, setState] = useState<AutoFetchState>(() =>
    seedSnapshot != null && typeof seedSnapshot.legalName === "string"
      ? {
          status: "verified",
          prefill: prefillFromPayload(seedSnapshot as NormalizedPayload),
        }
      : enabled
        ? { status: "idle" }
        : { status: "disabled" },
  );

  // Monotonic request token: THE authority for last-input-wins.
  const tokenRef = useRef(0);
  const lastSeenRef = useRef(normalizedInitial);
  // The seed holds only while the input equals the GSTIN it was fetched for
  // (or the initial input when the snapshot carries no gstin).
  const seedGstinRef = useRef<string | null>(
    seedSnapshot != null
      ? typeof seedSnapshot.gstin === "string"
        ? seedSnapshot.gstin.trim().toUpperCase()
        : normalizedInitial
      : null,
  );
  const seedAliveRef = useRef<boolean>(seedSnapshot != null);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "disabled" });
      return;
    }

    const candidate = gstinInput.trim().toUpperCase();

    // Any input change kills the seed view and retires in-flight work.
    if (candidate !== lastSeenRef.current) {
      tokenRef.current += 1;
      lastSeenRef.current = candidate;
      if (seedGstinRef.current !== null && candidate !== seedGstinRef.current) {
        seedAliveRef.current = false;
      }
    }

    if (candidate.length === 0 || !validateGstin(candidate).ok) {
      tokenRef.current += 1; // retire anything pending
      setState({ status: "idle" });
      return;
    }

    // Hold the cache-seeded verified view without refetching.
    if (
      seedAliveRef.current &&
      seedGstinRef.current !== null &&
      candidate === seedGstinRef.current &&
      seedSnapshot != null &&
      typeof seedSnapshot.legalName === "string"
    ) {
      return;
    }

    const token = ++tokenRef.current;

    const timer = setTimeout(() => {
      if (tokenRef.current !== token) return; // retired while debouncing
      setState({ status: "checking" }); // checking starts WITH the request
      void deps
        .lookup(candidate)
        .then((outcome) => {
          if (tokenRef.current !== token) return; // STALE DROP - last-input-wins
          if (outcome.outcome === "verified") {
            setState({
              status: "verified",
              prefill: prefillFromPayload(outcome.payload),
            });
          } else if (outcome.outcome === "not_found") {
            setState({ status: "fallback", reason: "not_found" });
          } else {
            setState({ status: "fallback", reason: "failed" }); // timeout counts as failed
          }
        })
        .catch(() => {
          if (tokenRef.current !== token) return;
          setState({ status: "fallback", reason: "failed" });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
    // deps.lookup identity must be stable across renders (scripted fakes are).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.lookup, enabled, gstinInput]);

  return { state };
}
