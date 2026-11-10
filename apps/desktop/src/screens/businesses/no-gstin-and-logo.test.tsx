// Businesses without a GSTIN, and logos picked while adding a business.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusinessSheet } from "./BusinessSheet";
import { LogoUploadField } from "./LogoUploadField";
import { validateBusinessForm, type BusinessFormValues } from "./business-schema";

const base: BusinessFormValues = {
  legal_name: "Corner Kirana",
  trade_name: "",
  gstin: "",
  address_text: "4 Station Road",
  city: "Pune",
  pincode: "411001",
  state_code: "27",
  phone: "",
  email: "",
  registration_type: "unregistered",
  number_format: "prefix_fy_seq",
  prefix: "BOS",
};

describe("business without a GSTIN", () => {
  it("validates without a GSTIN and normalizes it to null", () => {
    const { errors, normalized } = validateBusinessForm(base);
    expect(errors).toEqual({});
    expect(normalized?.gstin).toBeNull();
    expect(normalized?.registration_type).toBe("unregistered");
  });

  it("still requires a GSTIN for registered businesses", () => {
    const { errors } = validateBusinessForm({ ...base, registration_type: "regular" });
    expect(errors.gstin).toBe("GSTIN is required.");
  });

  it("the sheet's checkbox hides GSTIN and the scheme choice, and saves gstin null", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_values: unknown) => true);
    render(
      <BusinessSheet
        open
        mode="create"
        initial={{ ...base, registration_type: "regular" }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText("GSTIN")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /isn't registered for GST/ }));
    expect(screen.queryByLabelText("GSTIN")).toBeNull();
    expect(screen.queryByText("Registration type")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ gstin: null, registration_type: "unregistered" });
  });

  it("edit mode shows the locked no-GST note instead of a GSTIN field", () => {
    render(
      <BusinessSheet open mode="edit" initial={base} onClose={vi.fn()} onSubmit={vi.fn(async () => true)} />,
    );
    expect(screen.getByTestId("no-gstin-locked")).toHaveTextContent("Not registered for GST");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("LogoUploadField", () => {
  function storage() {
    const upload = vi.fn(async () => ({ data: {}, error: null }));
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://x/logo.png" }, error: null }));
    const deps = {
      storage: { from: () => ({ upload, remove: vi.fn(), createSignedUrl }) },
    };
    return { deps, upload };
  }

  it("uploads the image file itself, not just its name and size", async () => {
    const user = userEvent.setup();
    const { deps, upload } = storage();
    const onUploaded = vi.fn();
    const { container } = render(
      <LogoUploadField deps={deps} businessId="b1" existingPath={null} onUploaded={onUploaded} onRemoved={vi.fn()} />,
    );
    const file = new File(["png-bytes"], "logo.png", { type: "image/png" });
    await user.upload(container.querySelector("input[type=file]") as HTMLInputElement, file);
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("businesses/b1/logo.png"));
    expect(upload).toHaveBeenCalledWith("businesses/b1/logo.png", file, { upsert: true, contentType: "image/png" });
  });

  it("while adding a business, holds the picked file and shows a preview without uploading", async () => {
    const user = userEvent.setup();
    const { deps, upload } = storage();
    const onPicked = vi.fn();
    const createObjectURL = vi.fn(() => "blob:preview");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const { container } = render(
      <LogoUploadField
        deps={deps}
        businessId={null}
        existingPath={null}
        onUploaded={vi.fn()}
        onRemoved={vi.fn()}
        onPicked={onPicked}
      />,
    );
    const file = new File(["png-bytes"], "logo.png", { type: "image/png" });
    await user.upload(container.querySelector("input[type=file]") as HTMLInputElement, file);
    expect(onPicked).toHaveBeenCalledWith(file);
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByTestId("logo-preview")).toHaveAttribute("src", "blob:preview");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onPicked).toHaveBeenLastCalledWith(null);
  });
});
