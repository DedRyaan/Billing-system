// ItemSheet contracts (plan 03-09 Task 2): type-driven labeling, slab-bound
// select, soft-warning non-blocking, deactivate/reactivate confirms,
// read-only staff mirror.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemSheet } from "./ItemSheet";
import { UNIT_OPTIONS } from "../../lib/constants/units";

function mount(
  opts: Partial<Parameters<typeof ItemSheet>[0]> & {
    onSubmit?: (v: unknown) => Promise<boolean> | boolean;
  } = {},
) {
  const { onSubmit = async () => true, ...rest } = opts;
  return render(
    <ItemSheet open onClose={vi.fn()} mode="create" onSubmit={onSubmit as never} {...rest} />,
  );
}

describe("fields + segmented type control", () => {
  it("renders S6 field order; label swaps HSN* <-> SAC* with the type toggle", async () => {
    const user = userEvent.setup();
    mount({});
    expect(document.getElementById("item-code")?.closest("div")?.textContent ?? "").toContain("HSN");
    await user.click(screen.getByTestId("type-services"));
    // Label now reads SAC.
    const fieldLabel = Array.from(document.querySelectorAll("label")).find((l) =>
      l.textContent!.startsWith("SAC"),
    );
    expect(fieldLabel).toBeTruthy();
  });

  it("rate select binds EXACTLY to slab-derived options (seven labels)", () => {
    mount({ initial: { gst_rate_percent: "18" } });
    const select = document.getElementById("item-rate") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.text);
    expect(labels).toEqual([
      "Select rate…",
      "0%",
      "0.25%",
      "1.5%",
      "3%",
      "5%",
      "18%",
      "40%",
    ]);
    expect(labels.join(",")).not.toContain("12%");
    expect(labels.join(",")).not.toContain("28%");
  });

  it("unit select lists the app vocabulary verbatim", () => {
    mount({});
    const select = document.getElementById("item-unit") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values.slice(1)).toEqual([...UNIT_OPTIONS]);
  });
});

describe("soft vs hard gates", () => {
  it("bad HSN shows warning caption but Save stays enabled and submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    mount({
      onSubmit,
      initial: { name: "", kind: "goods", hsn_sac: "", gst_rate_percent: "", unit: "", price: "", mrp: "", stock_qty: "" },
    });

    await user.type(document.getElementById("item-name") as HTMLInputElement, "Consulting");
    await user.click(screen.getByTestId("type-services"));
    await user.type(document.getElementById("item-code") as HTMLInputElement, "123456"); // not 99-prefix
    await user.selectOptions(document.getElementById("item-rate") as HTMLSelectElement, "5");
    await user.selectOptions(document.getElementById("item-unit") as HTMLSelectElement, "HRS");
    await user.type((document.getElementById("item-price") as HTMLInputElement).parentElement!.querySelector("input")!, "2500");

    await waitFor(() => expect(screen.getByTestId("code-warning").textContent).toContain("99"));
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    await user.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("missing hard fields block the save and say why", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    mount({ onSubmit });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(false);
    await user.click(save);
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull());
  });
});

describe("lifecycle confirms (admins)", () => {
  it("Deactivate… opens the exact confirm then fires onDeactivate once", async () => {
    const user = userEvent.setup();
    const onDeactivate = vi.fn();
    mount({
      mode: "edit",
      itemName: "Notebook A4",
      initial: { name: "Notebook A4", is_active: true },
      onDeactivate,
    });
    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Deactivate Notebook A4?");
    expect(dialog.textContent).toContain(
      "Deactivated items disappear from bill picking but keep their history on past bills.",
    );
    await user.click(screen.getByRole("button", { name: "Deactivate item" }));
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it("inactive rows offer Reactivate instead", async () => {
    const user = userEvent.setup();
    const onReactivate = vi.fn();
    mount({
      mode: "edit",
      itemName: "Old Stock",
      initial: { name: "Old Stock", is_active: false },
      onReactivate,
    });
    await user.click(screen.getByRole("button", { name: "Reactivate…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Reactivate Old Stock?");
    await user.click(screen.getByRole("button", { name: "Reactivate item" }));
    expect(onReactivate).toHaveBeenCalledTimes(1);
  });

  it("create mode offers no lifecycle buttons", () => {
    mount({ mode: "create", onDeactivate: vi.fn(), onReactivate: vi.fn() });
    expect(screen.queryByRole("button", { name: "Deactivate…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reactivate…" })).toBeNull();
  });
});

describe("read-only staff mirror", () => {
  it("detail mode: readOnly inputs, hidden footer, note visible", () => {
    mount({
      mode: "detail",
      initial: { name: "Notebook A4", price: "149.50", unit: "PCS", gst_rate_percent: "18" },
    });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect((document.getElementById("item-name") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText("Read-only — catalog edits are admin-only.")).toBeTruthy();
  });
});
