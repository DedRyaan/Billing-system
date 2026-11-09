import { describe, expect, it } from "vitest";
import { formatPaise, formatRupees } from "./format";

describe("money formatting", () => {
  it("groups rupees the Indian way", () => {
    expect(formatPaise(0n)).toBe("₹0.00");
    expect(formatPaise(99999n)).toBe("₹999.99");
    expect(formatPaise(100000n)).toBe("₹1,000.00");
    expect(formatPaise(12345678n)).toBe("₹1,23,456.78");
    expect(formatPaise(123456789012n)).toBe("₹1,23,45,67,890.12");
  });

  it("formats DB numerics and negatives", () => {
    expect(formatRupees(11800)).toBe("₹11,800.00");
    expect(formatRupees("1499.5")).toBe("₹1,499.50");
    expect(formatRupees(-0.5)).toBe("-₹0.50");
    expect(formatRupees(-125000)).toBe("-₹1,25,000.00");
  });
});
