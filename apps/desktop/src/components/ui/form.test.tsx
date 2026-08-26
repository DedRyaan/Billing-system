// Form primitives behaviors - RED.
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { TextArea } from "./TextArea";
import { MoneyInput } from "./MoneyInput";
import { Select } from "./Select";
import { StatePicker } from "./StatePicker";
import { RadioCardGroup } from "./RadioCardGroup";

describe("Button", () => {
  it.each([
    ["primary", "bg-accent"],
    ["secondary", "border-hairline-strong"],
    ["ghost", "text-ink-secondary"],
    ["danger", "bg-danger"],
    ["danger-text", "text-danger"],
  ] as const)("renders variant %s with contracted classes", (variant, cls) => {
    render(<Button variant={variant}>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain(cls);
  });

  it.each([
    ["sm", "h-(--control-sm)"],
    ["md", "h-(--control-md)"],
    ["lg", "h-(--control-lg)"],
  ] as const)("renders size %s with control metric class", (size, cls) => {
    render(<Button size={size}>Go</Button>);
    expect(screen.getByRole("button").className).toContain(cls);
  });

  it("loading swaps the leading icon for a spinner but keeps the label; pointer blocked", () => {
    render(
      <Button loading leadingIcon={<span data-testid="lead" />}>
        Saving…
      </Button>,
    );
    expect(screen.queryByTestId("lead")).toBeNull();
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("disabled blocks pointer at 40% opacity", () => {
    render(<Button disabled>Go</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("opacity-40");
  });
});

describe("Field wiring", () => {
  it("label above, error below, aria-invalid + aria-describedby linked to control id", () => {
    render(
      <Field id="cust-name" label="Customer name" error="Name is required">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Customer name");
    expect(input.id).toBe("cust-name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("cust-name-desc");
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("helper text uses the muted tone path", () => {
    render(
      <Field id="f2" label="Notes" helper="Optional">
        <TextArea />
      </Field>,
    );
    const desc = document.getElementById("f2-desc");
    expect(desc?.className).toContain("text-ink-muted");
  });
});

describe("MoneyInput", () => {
  it("renders the rupee adornment inside the left edge and emits raw strings upward", async () => {
    function Probe() {
      const [v, setV] = useState("");
      return <MoneyInput value={v} onValueChange={setV} />;
    }
    render(<Probe />);
    expect(screen.getByText("₹")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox"), "1234.50");
    expect(screen.getByRole("textbox")).toHaveValue("1234.50");
  });
});

describe("Select", () => {
  it("options come ONLY from the typed options prop", () => {
    render(
      <Select
        value="18"
        onValueChange={() => undefined}
        options={[
          { value: "0", label: "Nil" },
          { value: "18", label: "18%" },
        ]}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.options.length).toBe(2);
  });
});

describe("StatePicker", () => {
  it("type-to-filter narrows STATE_CODES and Enter selects the highlighted entry", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const picks: any[] = [];
    render(
      <StatePicker
        value={null}
        onPick={(e) => {
          picks.push(e);
        }}
      />,
    );
    const combo = screen.getByRole("combobox");
    await userEvent.type(combo, "Karnataka");
    // Option visible while filtered...
    expect(screen.getByRole("option", { name: /Karnataka \(29\)/ })).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    // ...and Enter selects the highlighted entry (listbox closes on pick).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(picks[0]?.code).toBe("29");
    expect((combo as HTMLInputElement).value).toBe("Karnataka (29)");
  });

  it("'97' Other Territory carries the (UT) suffix", async () => {
    render(<StatePicker value={null} onPick={() => undefined} />);
    const combo = screen.getByRole("combobox");
    await userEvent.type(combo, "Other Territory");
    expect(
      screen.getByRole("option", { name: /Other Territory \(97\) \(UT\)/ }),
    ).toBeInTheDocument();
  });

  it("disabled keeps the combobox closed and uninteractive", async () => {
    render(<StatePicker value={null} onPick={() => undefined} disabled />);
    const combo = screen.getByRole("combobox") as HTMLInputElement;
    expect(combo.disabled).toBe(true);
    // Focus must NOT open the listbox (detail-mode readOnly parity).
    combo.focus();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("RadioCardGroup", () => {
  const OPTIONS = [
    { value: "regular", title: "Regular", consequence: "Issues tax invoices showing CGST+SGST." },
    { value: "composition", title: "Composition", consequence: "Pays a flat rate on yearly turnover." },
  ];

  it("cards render radio semantics; click selects; arrows move selection", async () => {
    function Probe() {
      const [v, setV] = useState("regular");
      return (
        <RadioCardGroup name="reg-type" value={v} onValueChange={setV} options={OPTIONS} />
      );
    }
    const { container } = render(<Probe />);
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.length).toBe(2);
    expect(radios[0]!.checked).toBe(true);

    await userEvent.click(screen.getByText("Composition"));
    expect(container.querySelector('input[value="composition"]')).toBeChecked();

    // Arrow keys move selection within the group (handler on the input).
    radios[1]?.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(container.querySelector('input[value="regular"]')).toBeChecked();
  });
});
