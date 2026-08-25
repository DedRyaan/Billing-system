// GSTIN auto-fetch lookup client (MSTR-03/D-76): best-effort public-search.
// SILENT DEGRADATION IS THE CONTRACT - every non-verified outcome is DATA and
// saving proceeds. The request carries ONLY the GSTIN (+optional key header),
// short timeout, no other PII (T-3-15). Absent env config disables the feature
// entirely.
//
// Endpoint wiring arrives via desktop env (VITE_GSTIN_LOOKUP_URL /
// VITE_GSTIN_LOOKUP_API_KEY) in the screen plan.

import { validateGstin } from "@billing/gst";

export type GstinLookupOutcome =
  | { outcome: "disabled" }
  | { outcome: "invalid_structure" }
  | { outcome: "verified"; payload: NormalizedParty }
  | { outcome: "not_found" }
  | { outcome: "failed"; reason: "network" | "unparsable" | "server_error" | "timeout" };

export interface LookupConfig {
  baseUrl?: string;
  apiKeyHeader?: { name: string; value: string };
}

export interface GstinLookupDeps {
  config?: LookupConfig;
  fetch?: typeof fetch;
}

export interface RegisteredAddress {
  lines: string[];
  city?: string | undefined;
  stateCode?: string | undefined;
  pincode?: string | undefined;
}

export interface NormalizedParty {
  legalName: string;
  tradeName?: string | undefined;
  registeredAddress?: RegisteredAddress | undefined;
  [key: string]: unknown;
}

const TIMEOUT_MS = 6000;

/** NEVER throws: unknown shapes degrade to an empty prefill object. */
export function normalizePartyPayload(raw: unknown): NormalizedParty {
  try {
    if (typeof raw !== "object" || raw === null) {
      return { legalName: "" };
    }
    const r = raw as Record<string, unknown>;

    // Narrow field probes across common registry shapes.
    const legalName =
      firstString(r["legal_name"], r["legalName"], r["lgnm"]) ?? "";
    const tradeName =
      firstString(r["trade_name"], r["tradeName"]) ?? undefined;

    const addrRaw =
      (typeof r["pradr"] === "object" && r["pradr"] !== null
        ? (r["pradr"] as Record<string, unknown>)["addr"]
        : r["addr"]) ?? r["address"];
    let registeredAddress: RegisteredAddress | undefined;
    if (typeof addrRaw === "object" && addrRaw !== null) {
      const a = addrRaw as Record<string, unknown>;
      const lines = [
        firstString(a["bno"]),
        firstString(a["st"]),
        firstString(a["loc"]),
      ].filter((s): s is string => typeof s === "string" && s.length > 0);
      registeredAddress = {
        lines,
        ...(firstString(a["city"], a["loc"], a["dst"]) !== undefined
          ? { city: firstString(a["city"], a["loc"], a["dst"]) }
          : {}),
        ...(firstString(a["stcd"], a["state_cd"]) !== undefined
          ? { stateCode: firstString(a["stcd"], a["state_cd"]) }
          : {}),
        ...(firstString(a["pncd"], a["pincode"]) !== undefined
          ? { pincode: firstString(a["pncd"], a["pincode"]) }
          : {}),
      };
    }

    return {
      legalName,
      ...(tradeName !== undefined ? { tradeName } : {}),
      ...(registeredAddress !== undefined ? { registeredAddress } : {}),
    };
  } catch {
    return { legalName: "" };
  }
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

async function extractBody(res: Response): Promise<{ kind: "json"; body: unknown } | { kind: "other" }> {
  try {
    const text = await res.text();
    try {
      return { kind: "json", body: JSON.parse(text) as unknown };
    } catch {
      return { kind: "other" };
    }
  } catch {
    return { kind: "other" };
  }
}

/**
 * Fetch the party behind a structurally valid GSTIN. Requires @billing/gst's
 * validateGstin to pass FIRST (else invalid_structure, zero network).
 * AbortSignal.timeout(6000) bounds every request.
 */
export async function fetchGstinParty(
  deps: GstinLookupDeps,
  args: { gstin: string },
): Promise<GstinLookupOutcome> {
  const config = deps.config;
  if (!config || !config.baseUrl) return { outcome: "disabled" };

  const structural = validateGstin(args.gstin);
  if (!structural.ok) return { outcome: "invalid_structure" };

  const doFetch = deps.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (config.apiKeyHeader) {
    headers[config.apiKeyHeader.name] = config.apiKeyHeader.value;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await doFetch(`${config.baseUrl}?gstin=${encodeURIComponent(args.gstin)}`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 404) return { outcome: "not_found" };
    if (res.status >= 500) return { outcome: "failed", reason: "server_error" };
    if (res.status >= 400) return { outcome: "not_found" };

    const body = await extractBody(res);
    if (body.kind === "other") return { outcome: "failed", reason: "unparsable" };

    // Registry wrappers vary; probe common envelopes then normalize.
    const envelope = body.body as Record<string, unknown>;
    const candidate =
      (typeof envelope === "object" && envelope !== null &&
      typeof (envelope as Record<string, unknown>)["result"] === "object"
        ? (envelope as Record<string, unknown>)["result"]
        : envelope);
    const normalized = normalizePartyPayload(candidate);
    if (normalized.legalName.length === 0) {
      // A 200 without usable fields is still degradation, not truth.
      return { outcome: "failed", reason: "unparsable" };
    }
    return { outcome: "verified", payload: normalized };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { outcome: "failed", reason: "timeout" };
    }
    return { outcome: "failed", reason: "network" };
  }
}

