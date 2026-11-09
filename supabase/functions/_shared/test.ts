// Drift guard for the generated GST bundle the Edge runtime imports.
// If this fails, run `pnpm bundle:gst` and redeploy finalize-invoice.
import { describe, expect, it } from "vitest";
import * as source from "../../../packages/gst/src/index";
// @ts-expect-error generated JS bundle has no type declarations
import * as bundle from "./gst.js";

describe("_shared/gst.js bundle", () => {
  it("exports exactly the package's runtime API", () => {
    expect(Object.keys(bundle).sort()).toEqual(Object.keys(source).sort());
  });

  it("computes the same invoice totals as the source engine", () => {
    const lines = [
      { qtyMilli: 2500n, unitPricePaise: 39999n, discountBps: 750n, gstRateBps: 1800n, pricingMode: "exclusive", character: "taxable" },
      { qtyMilli: 1000n, unitPricePaise: 12345n, discountBps: 0n, gstRateBps: 500n, pricingMode: "exclusive", character: "taxable" },
    ] as const;
    const ctx = { head: "IGST", registrationType: "regular", reverseCharge: false } as const;
    const a = source.totalInvoice(lines as never, ctx as never);
    const b = (bundle as typeof source).totalInvoice(lines as never, ctx as never);
    expect(b).toEqual(a);
    expect(a.ok).toBe(true);
  });
});
