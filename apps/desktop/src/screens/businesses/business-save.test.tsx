// The business sheet's Save button: never silently disabled.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusinessSheet } from "./BusinessSheet";
import { normalizePhone, validateBusinessForm, type BusinessFormValues } from "./business-schema";

const filled: BusinessFormValues = {
  legal_name: "Alpha Traders",
  trade_name: "",
  gstin: "27AAPFU0939F1ZV",
  address_text: "12 MG Road",
  city: "Pune",
  pincode: "411001",
  state_code: "27",
  phone: "",
  email: "",
  registration_type: "regular",
  number_format: "prefix_fy_seq",
  prefix: "INV",
};

describe("business Save", () => {
  it("accepts Indian phone numbers written with +91, 91 or a leading 0", () => {
    for (const phone of ["+91 98765 43210", "91 9876543210", "09876543210", "98765-43210"]) {
      expect(normalizePhone(phone)).toBe("9876543210");
      expect(validateBusinessForm({ ...filled, phone }).errors.phone).toBeUndefined();
    }
  });

  it("Save stays clickable on an incomplete form and points at what's missing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(
      <BusinessSheet open mode="create" initial={{ ...filled, prefix: "" }} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("Prefix is required for this numbering template.")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Prefix/)));
    expect(screen.getByRole("status")).toHaveTextContent("1 field needs attention");
  });

  it("a complete form saves", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_v: unknown) => true);
    render(<BusinessSheet open mode="create" initial={filled} onClose={vi.fn()} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });
});
