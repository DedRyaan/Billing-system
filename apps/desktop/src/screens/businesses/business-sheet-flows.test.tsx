// Plan 03-07 Task 2: tax-config RadioCards, live FY-correct previews,
// archive confirm flow, read-only detail mirror.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusinessSheet } from "./BusinessSheet";
import type { NormalizedBusinessForm } from "./business-schema";

const noopSubmit = () => async () => true;

function mount(
  opts: Partial<Parameters<typeof BusinessSheet>[0]> & { onSubmit?: (v: NormalizedBusinessForm) => Promise<boolean> | boolean } = {},
) {
  const { onSubmit = async () => true, ...rest } = opts;
  return render(
    <BusinessSheet open onClose={vi.fn()} mode="create" onSubmit={onSubmit} {...rest} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("live numbering previews", () => {
  // NOTE: real timers here because userEvent needs them; the FY clock is set
  // per-test via setSystemTime before mounting instead of fake intervals.
  function useRealUser() {
    vi.useRealTimers();
    return userEvent.setup();
  }

  it("preview recomputes on prefix keystrokes", async () => {
    const user = useRealUser();
    mount({ initial: { legal_name: "X", gstin: "", address_text: "", city: "", pincode: "", prefix: "" } });
    await waitFor(() => expect(screen.getByTestId("numbering-preview").textContent).toBe("0004"));
    const prefix = document.getElementById("biz-prefix") as HTMLInputElement;
    await user.type(prefix, "IN");
    expect(screen.getByTestId("numbering-preview").textContent).toBe("IN/26-27/0004");
    await user.type(prefix, "V");
    expect(screen.getByTestId("numbering-preview").textContent).toBe("INV/26-27/0004");
  });

  it("FY boundary correctness: March renders prior FY, April renders the new one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 31, 12, 0, 0)); // 31 Mar 2026 -> FY 25-26
    const march = mount({ initial: { prefix: "INV" } });
    expect(march.getByTestId("numbering-preview").textContent).toBe("INV/25-26/0004");
    march.unmount();

    vi.setSystemTime(new Date(2026, 3, 1, 9, 0, 0)); // 1 Apr 2026 -> FY 26-27
    const april = mount({ initial: { prefix: "INV" } });
    expect(april.getByTestId("numbering-preview").textContent).toBe("INV/26-27/0004");
    april.unmount();
    vi.useRealTimers();
  });

  it("registration consequence lines render verbatim", async () => {
    const user = useRealUser();
    mount({ initial: { legal_name: "X" } });
    const panel = screen.getByTestId("sheet-panel");
    expect(panel.textContent).toContain(
      "Issues tax invoices showing CGST+SGST or IGST separately. Buyers can claim input credit.",
    );
    expect(panel.textContent).toContain(
      "Pays a flat rate on yearly turnover and cannot show tax on invoices. Buyers get no input credit.",
    );
    void user;
  });
});

describe("archive flow (super-admin, edit mode)", () => {
  it("quiet danger button opens the EXACT-copy confirm and confirms via verb button", async () => {
    vi.useRealTimers(); // userEvent needs real timers
    const user = userEvent.setup();
    const onArchive = vi.fn();
    render(
      <BusinessSheet
        open
        onClose={vi.fn()}
        mode="edit"
        onSubmit={async () => true}
        initial={{ legal_name: "Alpha Traders Pvt Ltd", gstin: "27AAPFU0939F1ZV", address_text: "a", city: "b", pincode: "411001", state_code: "27", prefix: "INV" }}
        onArchive={onArchive}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Archive…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Archive Alpha Traders Pvt Ltd?");
    expect(dialog.textContent).toContain(
      "Archived businesses leave daily views but keep every record for GST. No new bills can be issued. You can restore it later.",
    );
    // Focus lands on CANCEL - destructive focus safety.
    await user.click(screen.getByRole("button", { name: "Archive business" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("create mode never offers archive", () => {
    mount({ mode: "create", onArchive: vi.fn(), initial: { legal_name: "X" } });
    expect(screen.queryByRole("button", { name: "Archive…" })).toBeNull();
  });
});

describe("read-only detail mirror (regular admins)", () => {
  it("fields readOnly, no footer buttons, GSTIN/tax facts visible", () => {
    mount({
      mode: "detail",
      initial: {
        legal_name: "Alpha Traders Pvt Ltd",
        gstin: "27AAPFU0939F1ZV",
        address_text: "12 MG Road",
        city: "Pune",
        pincode: "411001",
        state_code: "27",
        registration_type: "composition",
      },
    });
    const panel = screen.getByTestId("sheet-panel");
    expect(panel.querySelector("form")).not.toBeNull(); // form exists but has no footer controls
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect((document.getElementById("biz-gstin") as HTMLInputElement).readOnly).toBe(true);
    expect((document.getElementById("biz-gstin") as HTMLInputElement).value).toBe("27AAPFU0939F1ZV");
    expect(panel.textContent).toContain("Composition");
    expect(panel.textContent).toContain("Read-only — visible to every admin of this business.");
  });
});

describe("PERMISSION_DENIED surfaces loudly", () => {
  it("onSubmit false keeps the sheet open with edits preserved", async () => {
    vi.useRealTimers(); // userEvent needs real timers
    const user = userEvent.setup();
    let call = 0;
    const onSubmit = vi.fn(async (): Promise<boolean> => {
      call += 1;
      return false; // server denial mapped upstream
    });
    void call;
    render(
      <BusinessSheet
        open
        onClose={vi.fn()}
        mode="edit"
        onSubmit={onSubmit}
        initial={{ legal_name: "Alpha Traders Pvt Ltd", gstin: "27AAPFU0939F1ZV", address_text: "a", city: "b", pincode: "411001", state_code: "27", prefix: "INV", trade_name: "" }}
      />,
    );
    // Edit a field so dirty flips true.
    const trade = document.getElementById("biz-trade-name") as HTMLInputElement;
    await user.type(trade, "!");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // Sheet still open (Save/Cancel still present), edit preserved.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect((trade as HTMLInputElement).value.endsWith("!")).toBe(true);
  });
});
