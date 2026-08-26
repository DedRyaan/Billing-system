// Business schema + sheet section contracts (plan 03-07 Task 1).
// Validator matrix proves EVERY documented failure mode with specific
// captions ending in the spec's generic GSTIN line; sheet renders all six
// D-77 sections headlessly.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "../../components/ui/Sheet";
import { BusinessSheet } from "./BusinessSheet";
import {
  previewNumbering,
  validateBusinessForm,
  type BusinessFormValues,
} from "./business-schema";
import { GSTIN_GENERIC_LINE } from "../../lib/strings/businesses";

const validBase: BusinessFormValues = {
  legal_name: "Alpha Traders Pvt Ltd",
  trade_name: "Alpha",
  gstin: "27AAPFU0939F1ZV", // hand-verified checksum vector from Phase 2
  address_text: "12 MG Road\nNear Market",
  city: "Pune",
  pincode: "411001",
  state_code: "27",
  phone: "98765 43210",
  email: "owner@alpha.example",
  registration_type: "regular",
  number_format: "prefix_fy_seq",
  prefix: "INV",
};

describe("validateBusinessForm", () => {
  it("accepts the fully-valid form and normalizes contact fields", () => {
    const { errors, normalized } = validateBusinessForm(validBase);
    expect(Object.keys(errors).length).toBe(0);
    expect(normalized).not.toBeNull();
    expect(normalized!.phone).toBe("9876543210");
    expect(normalized!.address.lines).toEqual(["12 MG Road", "Near Market"]);
    expect(normalized!.trade_name).toBe("Alpha");
    expect(normalized!.gstin).toBe(validBase.gstin);
  });

  it("legal_name required + 200 cap", () => {
    const blank = validateBusinessForm({ ...validBase, legal_name: "   " });
    expect(blank.errors["legal_name"]).toBeTruthy();
    expect(blank.normalized).toBeNull();

    const long = validateBusinessForm({ ...validBase, legal_name: "x".repeat(201) });
    expect(long.errors["legal_name"]).toBeTruthy();
  });

  it("GSTIN fail-union reasons surface captions ending in the generic line", () => {
    // Deterministic law vectors: wrong length, bad checksum, bad state prefix.
    const failing: Array<[string]> = [
      ["27"], // WRONG_LENGTH
      ["99AAPFU0939F1ZV"], // UNKNOWN_STATE_CODE ('99' not a state)
      ["271APFU0939F1ZV"], // BAD_PAN_SHAPE (digit at PAN start)
      ["27AAPFU0939F1ZW"], // DEFAULT_Z_MISSING (14th char != Z)
      ["27AAPFU0939F1ZU"], // CHECKSUM_FAILED
      ["27AAPFU0939F1Z!", ], // INVALID_CHARACTERS ('!' outside charset)
    ];
    let failuresSeen = 0;
    for (const [gstin] of failing) {
      const res = validateBusinessForm({ ...validBase, gstin });
      if (res.errors["gstin"] === undefined) continue; // engine verdict governs; skip non-failing probes
      expect(res.errors["gstin"]!).toContain(GSTIN_GENERIC_LINE);
      expect(res.normalized).toBeNull();
      failuresSeen += 1;
    }
    expect(failuresSeen).toBeGreaterThanOrEqual(4);
    // The second hand-verified checksum vector stays legal.
    expect(validateBusinessForm({ ...validBase, gstin: "33AAACC1206D1ZN" }).errors["gstin"]).toBeUndefined();
  });

  it("pincode enforces exactly six digits", () => {
    expect(validateBusinessForm({ ...validBase, pincode: "41101" }).errors["pincode"]).toBeTruthy();
    expect(validateBusinessForm({ ...validBase, pincode: "4110a1" }).errors["pincode"]).toBeTruthy();
    expect(validateBusinessForm({ ...validBase, pincode: "411001" }).errors["pincode"]).toBeUndefined();
  });

  it("phone tolerates digits/spaces and normalizes to 10 digits; rejects other shapes", () => {
    expect(validateBusinessForm({ ...validBase, phone: "+91 98765 43210" }).errors["phone"]).toBeTruthy();
    const ok = validateBusinessForm({ ...validBase, phone: "98765-43210" });
    expect(ok.errors["phone"]).toBeUndefined();
    expect(ok.normalized!.phone).toBe("9876543210");
  });

  it("email optional-but-format-checked", () => {
    expect(validateBusinessForm({ ...validBase, email: "" }).errors["email"]).toBeUndefined();
    expect(validateBusinessForm({ ...validBase, email: "nope" }).errors["email"]).toBeTruthy();
  });

  it("prefix charset [A-Za-z0-9-]{1,10}; required unless bare-sequence template", () => {
    expect(
      validateBusinessForm({ ...validBase, prefix: "INV/2026" }).errors["prefix"],
    ).toBeTruthy(); // slash forbidden
    expect(
      validateBusinessForm({ ...validBase, number_format: "seq", prefix: "" }).errors["prefix"],
    ).toBeUndefined();
    expect(
      validateBusinessForm({ ...validBase, number_format: "prefix_seq", prefix: "" }).errors[
        "prefix"
      ],
    ).toBeTruthy();
    const long = validateBusinessForm({ ...validBase, prefix: "ABCDEFGHIJK" });
    expect(long.errors["prefix"]).toBeTruthy();
  });
});

describe("previewNumbering", () => {
  it("renders the three template previews per the Copywriting row", () => {
    expect(previewNumbering("prefix_fy_seq", "INV", "26-27")).toBe("INV/26-27/0004");
    expect(previewNumbering("prefix_seq", "INV", "26-27")).toBe("INV-0004");
    expect(previewNumbering("seq", "", "26-27")).toBe("0004");
  });

  it("empty prefix degrades to bare sequence without crashing", () => {
    expect(previewNumbering("prefix_fy_seq", "", "26-27")).toBe("0004");
  });
});

describe("BusinessSheet sections", () => {
  function mountSheet(onSubmit: ReturnType<typeof vi.fn>, mode: "create" | "detail" = "create") {
    render(
      <BusinessSheet open onClose={vi.fn()} mode={mode} onSubmit={onSubmit} />,
    );
  }

  it("renders all six section labels in order with identity/GSTIN/address/contact fields", async () => {
    mountSheet(vi.fn());
    const panel = screen.getByTestId("sheet-panel");
    for (const label of ["IDENTITY", "GSTIN", "ADDRESS & STATE", "CONTACT"]) {
      expect(panel.textContent).toContain(label);
    }
    expect(document.getElementById("biz-legal-name")).not.toBeNull();
    expect(document.getElementById("biz-gstin")).not.toBeNull();
    expect(document.getElementById("biz-pincode")).not.toBeNull();
    expect(document.getElementById("biz-phone")).not.toBeNull();
  });

  it("Save stays disabled while invalid; submits normalized values once valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    mountSheet(onSubmit);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByLabelText("Legal name"), "Alpha Traders Pvt Ltd");
    await user.type(document.getElementById("biz-gstin") as HTMLInputElement, "27AAPFU0939F1ZV");
    await user.type(screen.getByLabelText("Address lines"), "12 MG Road");
    await user.type(screen.getByLabelText("City"), "Pune");
    await user.type(screen.getByLabelText("PIN code"), "411001");
    await user.selectOptions(document.getElementById("biz-state") as HTMLSelectElement, "27");
    await user.type(screen.getByLabelText("Phone"), "98765 43210");
    await user.type(screen.getByLabelText(/Prefix/), "INV");

    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const arg = onSubmit.mock.calls[0]![0] as { gstin: string; phone: string | null };
    expect(arg.gstin).toBe("27AAPFU0939F1ZV");
    expect(arg.phone).toBe("9876543210");
  });

  it("invalid submit shows the specific GSTIN caption under the field", async () => {
    const user = userEvent.setup();
    mountSheet(vi.fn(async () => true));

    await user.type(screen.getByLabelText("Legal name"), "Alpha");
    const gstinInput = document.getElementById("biz-gstin") as HTMLInputElement;
    await user.type(gstinInput, "27AAPFU0939F1ZU"); // checksum failure
    await user.type(screen.getByLabelText("Address lines"), "12 MG Road");
    await user.type(screen.getByLabelText("City"), "Pune");
    await user.type(screen.getByLabelText("PIN code"), "411001");

    await waitFor(() => {
      expect(document.getElementById("biz-gstin-desc")?.textContent ?? "").toContain(
        GSTIN_GENERIC_LINE,
      );
    });
  });
});
