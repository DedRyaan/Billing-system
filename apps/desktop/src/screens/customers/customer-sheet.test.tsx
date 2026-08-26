// CustomerSheet contracts (plan 03-08 Task 2, MSTR-01/MSTR-03).
// Validation truth: only name/state required; empty GSTIN is LEGAL; verified
// hints never block Save; snapshots embed on verified saves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomerSheet } from "./CustomerSheet";
import type { AutoFetchOutcome } from "./useGstinAutoFetch";

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

function mount(
  opts: Partial<Parameters<typeof CustomerSheet>[0]> & {
    onSubmit?: (v: unknown) => Promise<boolean>;
    lookup?: (gstin: string) => Promise<AutoFetchOutcome>;
  } = {},
) {
  const { onSubmit = async () => true, lookup, ...rest } = opts;
  return render(
    <CustomerSheet
      open
      onClose={vi.fn()}
      mode="create"
      businessId="bid-1"
      onSubmit={onSubmit as never}
      {...(lookup !== undefined ? { lookup } : {})}
      {...rest}
    />,
  );
}

describe("validation truth", () => {
  it("only name and state are required; empty GSTIN is legal", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    mount({ onSubmit });

    await user.type(screen.getByLabelText("Legal name*"), "Ravi Kumar");
    await user.selectOptions(document.getElementById("cust-state") as HTMLSelectElement, "27");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const arg = (onSubmit.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]!;
    expect(arg["name"]).toBe("Ravi Kumar");
    expect(arg["gstin"]).toBeNull(); // empty stays null, never ""
  });

  it("a structurally-invalid GSTIN blocks with the specific caption ending in the generic line", async () => {
    const user = userEvent.setup();
    mount({});
    await user.type(screen.getByLabelText("Legal name*"), "Ravi");
    await user.selectOptions(document.getElementById("cust-state") as HTMLSelectElement, "27");
    await user.type(document.getElementById("cust-gstin") as HTMLInputElement, "27AAPFU0939F1ZU"); // checksum
    await waitFor(() => {
      expect(document.getElementById("cust-gstin-desc")?.textContent ?? "").toContain(
        "Enter a valid 15-character GSTIN.",
      );
    });
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("auto-fetch integration", () => {
  it("verified prefill fills UNTOUCHED fields only and shows the exact hint", async () => {
    const user = userEvent.setup();
    mount({
      lookup: async () => ({
        outcome: "verified",
        payload: {
          legalName: "Alpha Traders Pvt Ltd",
          registeredAddress: { lines: ["12 MG Road"], city: "Pune", stateCode: "27", pincode: "411001" },
        },
      }),
    });

    // User edits legal_name FIRST - the dirty-field guard must protect it.
    await user.type(screen.getByLabelText("Legal name*"), "My Own Name");
    await user.type(document.getElementById("cust-gstin") as HTMLInputElement, "27AAPFU0939F1ZV");

    // Debounce 600ms + resolution.
    await waitFor(
      () =>
        expect((document.getElementById("cust-gstin-desc")?.textContent ?? "")).toContain(
          "Filled from the GST public registry — edit anything before saving.",
        ),
      { timeout: 3000 },
    );
    expect((document.getElementById("cust-legal-name") as HTMLInputElement).value).toBe("My Own Name");
    // Merged values flush on the render AFTER the hint appears - assert via waitFor.
    await waitFor(() =>
      expect((document.getElementById("cust-city") as HTMLInputElement).value).toBe("Pune"),
    );
    await waitFor(() =>
      expect((document.getElementById("cust-pincode") as HTMLInputElement).value).toBe("411001"),
    );
  });

  it("not_found shows the muted fallback hint and never blocks saving", async () => {
    const user = userEvent.setup();
    mount({
      lookup: async () => ({ outcome: "not_found" }),
      initial: { name: "", state_code: "" },
    });
    await user.type(screen.getByLabelText("Legal name*"), "Someone");
    await user.selectOptions(document.getElementById("cust-state") as HTMLSelectElement, "27");
    await user.type(document.getElementById("cust-gstin") as HTMLInputElement, "33AAACC1206D1ZN");

    await waitFor(
      () =>
        expect((document.getElementById("cust-gstin-desc")?.textContent ?? "")).toContain(
          "Couldn't fetch automatically. Fill the details manually — nothing is blocked.",
        ),
      { timeout: 3000 },
    );
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("save composition", () => {
  it("embeds the _gstin_lookup snapshot on verified saves", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    mount({
      onSubmit,
      lookup: async () => ({
        outcome: "verified",
        payload: { legalName: "Alpha Traders Pvt Ltd" },
      }),
    });
    await user.type(screen.getByLabelText("Legal name*"), "Typed Name");
    await user.selectOptions(document.getElementById("cust-state") as HTMLSelectElement, "27");
    await user.type(document.getElementById("cust-gstin") as HTMLInputElement, "27AAPFU0939F1ZV");
    await waitFor(
      () =>
        expect((document.getElementById("cust-gstin-desc")?.textContent ?? "")).toContain(
          "Filled from the GST public registry",
        ),
      { timeout: 3000 },
    );
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const arg = (onSubmit.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]!;
    const address = arg["address"] as Record<string, unknown> | null;
    expect(address?.["_gstin_lookup"]).toBeTruthy();
  });

  it("plain saves carry no snapshot key", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    mount({ onSubmit });
    await user.type(screen.getByLabelText("Legal name*"), "Plain Person");
    await user.selectOptions(document.getElementById("cust-state") as HTMLSelectElement, "29");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const arg = (onSubmit.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]!;
    expect(arg["address"]).toBeNull();
  });
});
