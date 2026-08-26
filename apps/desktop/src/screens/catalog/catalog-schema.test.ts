// Catalog schema contracts (plan 03-09 Task 1): slab law double gate,
// hard/soft validation split, paise parsing, unit vocabulary.
import { describe, expect, it } from "vitest";
import {
  slabRateOptions,
  validateCatalogForm,
  type CatalogFormValues,
} from "./catalog-schema";

const validBase: CatalogFormValues = {
  name: "Notebook A4",
  kind: "goods",
  hsn_sac: "482020",
  gst_rate_percent: "18",
  unit: "PCS",
  price: "149.50",
  mrp: "199",
  stock_qty: "12",
};

describe("slab law (A9/Risk 7)", () => {
  it("rate options derive EXCLUSIVELY from CURRENT_SLABS_BPS with pinned labels", () => {
    expect(slabRateOptions().map((o) => o.label)).toEqual([
      "0%",
      "0.25%",
      "1.5%",
      "3%",
      "5%",
      "18%",
      "40%",
    ]);
  });

  it("abolished 12%/28% can never appear as an option or pass the save gate", () => {
    const labels = slabRateOptions().map((o) => o.label);
    expect(labels).not.toContain("12%");
    expect(labels).not.toContain("28%");
    // Hand-typed abolished rates fail validation even if someone injects them.
    for (const banned of ["12", "28"]) {
      const res = validateCatalogForm({ ...validBase, gst_rate_percent: banned });
      expect(res.errors["gst_rate_percent"]).toBeTruthy();
      expect(res.normalized).toBeNull();
    }
  });
});

describe("hard vs soft split", () => {
  it("valid form normalizes to engine-shaped values", () => {
    const { errors, warnings, normalized } = validateCatalogForm(validBase);
    expect(Object.keys(errors).length).toBe(0);
    expect(normalized).not.toBeNull();
    expect(normalized!.gstRateBps).toBe(1800n);
    expect(normalized!.pricePaise).toBe(14950n);
    expect(normalized!.mrpPaise).toBe(19900n);
    expect(normalized!.stockQty).toBe(12);
    expect(normalized!.hsnSacWarning).toBeNull();
    void warnings;
  });

  it("HSN/SAC structural miss yields a WARNING that does NOT block save", () => {
    const res = validateCatalogForm({
      ...validBase,
      hsn_sac: "48AB20", // non-digit chars
    });
    expect(res.errors["hsn_sac"]).toBeUndefined();
    expect(res.warnings["hsn_sac"]).toBeTruthy();
    expect(res.normalized).not.toBeNull();
    expect(res.normalized!.hsnSacWarning).toBeTruthy();
  });

  it("SAC kind validates services codes (99-prefix) softly", () => {
    const badSac = validateCatalogForm({ ...validBase, kind: "services", hsn_sac: "123456" });
    expect(badSac.errors["hsn_sac"]).toBeUndefined();
    expect(badSac.warnings["hsn_sac"]).toContain("99");
    const goodSac = validateCatalogForm({ ...validBase, kind: "services", hsn_sac: "997212" });
    expect(goodSac.warnings["hsn_sac"]).toBeUndefined();
  });

  it("price/MRP parse failures HARD block", () => {
    const res = validateCatalogForm({ ...validBase, price: "14a.5", mrp: "-3" });
    expect(res.errors["price"]).toBeTruthy();
    expect(res.errors["mrp"]).toBeTruthy();
    expect(res.normalized).toBeNull();
  });

  it("stock accepts integers >= 0 only", () => {
    expect(validateCatalogForm({ ...validBase, stock_qty: "-1" }).errors["stock_qty"]).toBeTruthy();
    expect(validateCatalogForm({ ...validBase, stock_qty: "2.5" }).errors["stock_qty"]).toBeTruthy();
    expect(validateCatalogForm({ ...validBase, stock_qty: "0" }).errors["stock_qty"]).toBeUndefined();
    const zeroStock = validateCatalogForm({ ...validBase, stock_qty: "" });
    expect(zeroStock.normalized!.stockQty).toBe(0); // empty defaults to 0
  });

  it("name required; unit constrained to the app vocabulary", () => {
    expect(validateCatalogForm({ ...validBase, name: "  " }).errors["name"]).toBeTruthy();
    expect(validateCatalogForm({ ...validBase, unit: "BOTTLES" }).errors["unit"]).toBeTruthy();
    expect(validateCatalogForm({ ...validBase, unit: "SQF" }).errors["unit"]).toBeUndefined();
  });
});
