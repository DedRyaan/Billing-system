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
