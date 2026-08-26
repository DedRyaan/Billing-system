// CR-04 regression suite: the logo pipeline must thread the REAL extension
// end-to-end. Previously createSignedLogoUrl/removeLogo hardcoded `.png`, so
// jpg/jpeg/svg uploads never rendered a preview (signed URL targeted a
// nonexistent object) and Remove deleted nothing while reporting success.
//
//   (a) an EXISTING svg logo signs + previews from its own path
//   (b) uploading a .jpg signs + previews logo.jpg; onUploaded carries it
//   (c) Remove targets the real object; storage failures toast instead of
//       silently reporting success, and Retry completes once storage recovers

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogoUploadField as LogoUploadFieldComponent } from "./LogoUploadField";
import { ToastHost } from "../../shell/ToastHost";

const BID = "bid-1";

type FieldDeps = Parameters<typeof LogoUploadFieldComponent>[0]["deps"];

interface StorageOutcome {
  data: unknown;
  error: unknown;
}

function makeDeps(overrides: {
  remove?: () => StorageOutcome;
} = {}) {
  const createSignedUrl = vi.fn(
    async (_path: string, _expires: number): Promise<StorageOutcome> => ({
      data: { signedUrl: "https://signed.example/logo" },
      error: null,
    }),
  );
  const upload = vi.fn(async (): Promise<StorageOutcome> => ({ data: {}, error: null }));
  const remove = vi.fn(
    async (_paths: string[]): Promise<StorageOutcome> => ({ data: null, error: null }),
  );
  if (overrides.remove) remove.mockImplementation(async () => overrides.remove!());
  const deps = {
    storage: {
      from: () => ({ upload, remove, createSignedUrl }),
    },
  } as unknown as FieldDeps;
  return { deps, createSignedUrl, upload, remove };
}

function fakeFile(name: string, type: string): File {
  return { name, type, size: 500 } as unknown as File;
}

function mountField(props: {
  existingPath: string | null;
  deps: FieldDeps;
  onUploaded?: (path: string) => void;
  onRemoved?: () => void;
}) {
  return render(
    <>
      <LogoUploadFieldComponent
        deps={props.deps}
        businessId={BID}
        existingPath={props.existingPath}
        {...(props.onUploaded ? { onUploaded: props.onUploaded } : { onUploaded: vi.fn() })}
        {...(props.onRemoved ? { onRemoved: props.onRemoved } : { onRemoved: vi.fn() })}
      />
      <ToastHost />
    </>,
  );
}

function fileInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(
    '[data-testid="logo-upload"] input[type="file"]',
  )!;
}

describe("CR-04: logo extension handling", () => {
  it("signs and previews an EXISTING svg logo from its own path", async () => {
    const { deps, createSignedUrl } = makeDeps();
    mountField({ existingPath: `businesses/${BID}/logo.svg`, deps });
    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledTimes(1));
    expect(createSignedUrl.mock.calls[0]?.[0]).toBe(`businesses/${BID}/logo.svg`);
    expect(await screen.findByTestId("logo-preview")).toBeInTheDocument();
  });

  it("uploads a .jpg and previews logo.jpg - not a phantom logo.png", async () => {
    const { deps, createSignedUrl } = makeDeps();
    const onUploaded = vi.fn();
    mountField({ existingPath: null, deps, onUploaded });

    fireEvent.change(fileInput(), { target: { files: [fakeFile("mark.jpg", "image/jpeg")] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(`businesses/${BID}/logo.jpg`));
    await waitFor(() =>
      expect(createSignedUrl).toHaveBeenLastCalledWith(`businesses/${BID}/logo.jpg`, 300),
    );
    expect(await screen.findByTestId("logo-preview")).toBeInTheDocument();
  });

  it("Remove deletes the REAL object and surfaces storage failures instead of silent success", async () => {
    const user = userEvent.setup();
    const { deps, remove } = makeDeps({
      remove: () => ({ data: null, error: { message: "bucket denied" } }),
    });
    const onRemoved = vi.fn();
    mountField({
      existingPath: `businesses/${BID}/logo.jpeg`,
      deps,
      onRemoved,
    });
    expect(await screen.findByTestId("logo-preview")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove.mock.calls[0]?.[0]).toEqual([`businesses/${BID}/logo.jpeg`]);
    // Failure is DATA now: no false success, row untouched, toast shown.
    expect(onRemoved).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Couldn't save logo. Your changes were undone."),
    ).toBeInTheDocument();

    // Retry after the storage recovers completes the removal.
    remove.mockImplementation(async () => ({ data: null, error: null }));
    await user.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("logo-preview")).toBeNull());
  });
});
