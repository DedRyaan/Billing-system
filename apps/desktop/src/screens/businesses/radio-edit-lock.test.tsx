// WR-05 regression suite: registration-type and numbering-template are
// CREATE-ONLY facts (the api patch builder omits them on update). Their
// RadioCardGroups must therefore be DISABLED in edit mode - previously they
// stayed interactive and silently discarded flips on save.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusinessSheet } from "./BusinessSheet";

function mountSheet(mode: "create" | "edit") {
  return render(
    <BusinessSheet
      open
      mode={mode}
      {...(mode === "edit"
        ? {
            initial: {
              legal_name: "Alpha Traders Pvt Ltd",
              gstin: "27AAPFU0939F1ZV",
              address_text: "12 MG Road",
              city: "Pune",
              pincode: "411001",
              state_code: "27",
              registration_type: "regular" as const,
              number_format: "seq" as const,
            },
          }
        : {})}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
}

describe("WR-05: tax-config groups disable in edit mode", () => {
  it("create mode keeps both radio groups editable", () => {
    mountSheet("create");
    expect(
      document.querySelector<HTMLInputElement>('input[name="registration-type"][value="composition"]')!
        .disabled,
    ).toBe(false);
    expect(
      document.querySelector<HTMLInputElement>('input[name="numbering-template"][value="prefix_seq"]')!
        .disabled,
    ).toBe(false);
  });

  it("edit mode disables BOTH groups - flipping Regular→Composition is impossible", async () => {
    mountSheet("edit");
    const composition = document.querySelector<HTMLInputElement>(
      'input[name="registration-type"][value="composition"]',
    )!;
    const prefixSeq = document.querySelector<HTMLInputElement>(
      'input[name="numbering-template"][value="prefix_seq"]',
    )!;
    expect(composition.disabled).toBe(true);
    expect(prefixSeq.disabled).toBe(true);

    // Even a forced click cannot change the value (no silent write loss).
    await userEvent.setup().click(screen.getByText("Composition"));
    expect(composition.checked).toBe(false);
  });
});
