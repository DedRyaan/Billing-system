// Query-key factory behaviors (plan 03-04 Task 1) - RED.
import { describe, expect, it } from "vitest";
import { GLOBAL_BUSINESS, keysFor } from "../src/query-keys";

describe("keysFor", () => {
  it("produces [entity, businessId] shaped tuples", () => {
    expect(keysFor.customers("b-1")).toEqual(["customers", "b-1"]);
    expect(keysFor.catalogItems("b-2")).toEqual(["catalog_items", "b-2"]);
    expect(keysFor.memberships("user-7")).toEqual(["memberships", "user-7"]);
    expect(keysFor.businesses()).toEqual(["businesses", GLOBAL_BUSINESS]);
    expect(keysFor.businesses("b-3")).toEqual(["businesses", "b-3"]);
  });

  it("two different businessIds NEVER collide", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const k = keysFor.customers(`biz-${i}`);
      const serialized = JSON.stringify(k);
      expect(seen.has(serialized)).toBe(false);
      seen.add(serialized);
    }
    expect(JSON.stringify(keysFor.customers("biz-0"))).not.toEqual(
      JSON.stringify(keysFor.catalogItems("biz-0")),
    );
  });

  it("freezes tuples so accidental mutation fails loudly", () => {
    expect(Object.isFrozen(keysFor.customers("b-1"))).toBe(true);
  });

  it("extra segments prefix-match the base key (switch-time invalidation)", () => {
    const base = keysFor.customers("b-1");
    const detail = keysFor.customers("b-1", "detail", "row-9");
    expect(detail.slice(0, base.length)).toEqual(base);
    // ...but a foreign business's detail never matches.
    expect(detail.slice(0, base.length)).not.toEqual(keysFor.customers("b-other"));
  });
});

describe("keysFor.payments", () => {
  it("produces [\"payments\", businessId] for bare call", () => {
    expect(keysFor.payments("b-1")).toEqual(["payments", "b-1"]);
  });

  it("produces [\"payments\", businessId, invoiceId] with rest segment", () => {
    expect(keysFor.payments("b-1", "inv-1")).toEqual(["payments", "b-1", "inv-1"]);
  });

  it("freezes tuples so accidental mutation fails loudly", () => {
    expect(Object.isFrozen(keysFor.payments("b-1"))).toBe(true);
    expect(Object.isFrozen(keysFor.payments("b-1", "inv-1"))).toBe(true);
  });

  it("two different businessIds never collide", () => {
    expect(JSON.stringify(keysFor.payments("b-1"))).not.toEqual(
      JSON.stringify(keysFor.payments("b-2")),
    );
  });

  it("extra segments prefix-match the base key (switch-time invalidation)", () => {
    const base = keysFor.payments("b-1");
    const detail = keysFor.payments("b-1", "inv-1");
    expect(detail.slice(0, base.length)).toEqual(base);
    expect(detail.slice(0, base.length)).not.toEqual(keysFor.payments("b-other"));
  });
});

describe("keysFor.outstandings", () => {
  it("produces [\"outstandings\", businessId]", () => {
    expect(keysFor.outstandings("b-1")).toEqual(["outstandings", "b-1"]);
  });

  it("freezes tuples", () => {
    expect(Object.isFrozen(keysFor.outstandings("b-1"))).toBe(true);
  });

  it("two different businessIds never collide", () => {
    expect(JSON.stringify(keysFor.outstandings("b-1"))).not.toEqual(
      JSON.stringify(keysFor.outstandings("b-2")),
    );
  });

  it("payments and outstandings keys never collide for same businessId", () => {
    expect(JSON.stringify(keysFor.payments("b-1"))).not.toEqual(
      JSON.stringify(keysFor.outstandings("b-1")),
    );
  });
});
