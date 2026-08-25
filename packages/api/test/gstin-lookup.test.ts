// GSTIN auto-fetch lookup client behaviors - RED.
import { describe, expect, it, vi } from "vitest";
import { fetchGstinParty, normalizePartyPayload } from "../src/gstin-lookup";

const VALID_GSTIN = "27AAPFU0939F1ZV";

function okFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("fetchGstinParty silent-degradation contract (D-76)", () => {
  it("config absent => disabled without any network call", async () => {
    const fetchMock = vi.fn();
    const res = await fetchGstinParty({ fetch: fetchMock as unknown as typeof fetch }, { gstin: VALID_GSTIN });
    expect(res).toEqual({ outcome: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("structurally invalid GSTIN => invalid_structure, no network call", async () => {
    const fetchMock = vi.fn();
    const res = await fetchGstinParty(
      { config: { baseUrl: "https://gst.example" }, fetch: fetchMock as unknown as typeof fetch },
      { gstin: "27AAPFU0939FXXX" },
    );
    expect(res).toEqual({ outcome: "invalid_structure" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verified payload carries the normalized party", async () => {
    const registryShape = {
      legal_name: "ACME TRADERS PRIVATE LIMITED",
      pradr: { addr: { bno: "12", st: "MG Road", loc: "Pune", pncd: "411001" } },
      stj_cd: "MH",
    };
    const fetchMock = okFetch(registryShape);
    const res = await fetchGstinParty(
      { config: { baseUrl: "https://gst.example" }, fetch: fetchMock },
      { gstin: VALID_GSTIN },
    );
    expect(res.outcome).toBe("verified");
    if (res.outcome === "verified") {
      expect(res.payload.legalName).toBe("ACME TRADERS PRIVATE LIMITED");
    }
    // Request carried ONLY the GSTIN (+optional key header), nothing else.
    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headerRecord = (init.headers ?? {}) as Record<string, string>;
    expect(headerRecord["content-type"] ?? "").toBe("");
  });

  it("404-class responses degrade to not_found", async () => {
    const res = await fetchGstinParty(
      { config: { baseUrl: "https://gst.example" }, fetch: okFetch({}, 404) },
      { gstin: VALID_GSTIN },
    );
    expect(res).toEqual({ outcome: "not_found" });
  });

  it("500s map to failed('server_error') - data, not exceptions", async () => {
    const res = await fetchGstinParty(
      { config: { baseUrl: "https://gst.example" }, fetch: okFetch("boom", 500) },
      { gstin: VALID_GSTIN },
    );
    expect(res.outcome).toBe("failed");
    if (res.outcome === "failed") expect(res.reason).toBe("server_error");
  });

  it("HTML garbage degrades to failed('unparsable'), never throws", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("<html>blocked</html>", { status: 200 }) as unknown as Response,
    ) as unknown as typeof fetch;
    const res = await fetchGstinParty(
      { config: { baseUrl: "https://gst.example" }, fetch: fetchMock },
      { gstin: VALID_GSTIN },
    );
    expect(res.outcome).toBe("failed");
    if (res.outcome === "failed") expect(res.reason).toBe("unparsable");
  });

  it("network rejection degrades to failed('network')", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const res = await fetchGstinParty(
      { config: { baseUrl: "https://gst.example" }, fetch: fetchMock },
      { gstin: VALID_GSTIN },
    );
    if (res.outcome === "failed") expect(res.reason).toBe("network");
    else throw new Error("expected failed");
  });

  it("optional apiKeyHeader rides along on the request", async () => {
    const fetchMock = okFetch({ legal_name: "X" });
    await fetchGstinParty(
      {
        config: {
          baseUrl: "https://gst.example",
          apiKeyHeader: { name: "x-api-key", value: "secret" },
        },
        fetch: fetchMock,
      },
      { gstin: VALID_GSTIN },
    );
    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
  });

  it("GET url is baseUrl?gstin=...", async () => {
    const fetchMock = okFetch({});
    await fetchGstinParty(
      { config: { baseUrl: "https://gst.example/search" }, fetch: fetchMock },
      { gstin: VALID_GSTIN },
    );
    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`https://gst.example/search?gstin=${VALID_GSTIN}`);
  });
});

describe("normalizePartyPayload never throws", () => {
  it("maps the canonical registry shape into prefill", () => {
    const party = normalizePartyPayload({
      legal_name: "ACME",
      pradr: { addr: { bno: "12", st: "MG Road", loc: "Pune", pncd: "411001" } },
      stj_cd: "MH",
    });
    expect(party.legalName).toBe("ACME");
    expect(party.registeredAddress?.city).toBe("Pune");
    expect(party.registeredAddress?.pincode).toBe("411001");
  });

  it("unknown shapes yield empty-ish prefill objects, never exceptions", () => {
    for (const garbage of [null, undefined, 42, {}, { weird: true }]) {
      expect(() => normalizePartyPayload(garbage)).not.toThrow();
      expect(normalizePartyPayload(garbage)).toHaveProperty("legalName");
    }
  });
});
