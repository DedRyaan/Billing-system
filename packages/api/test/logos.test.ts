// Logo storage module behaviors - RED.
import { describe, expect, it, vi } from "vitest";
import { createSignedLogoUrl, removeLogo, uploadLogo } from "../src/logos";

function fakeStorage() {
  const upload = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
    data: { path: "x" },
    error: null,
  }));
  const remove = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
    data: null,
    error: null,
  }));
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: "https://signed.example/logo" },
    error: null,
  }));
  return {
    deps: {
      storage: {
        from(_bucket: string) {
          return { upload, remove, createSignedUrl };
        },
      },
    },
    upload,
    remove,
    createSignedUrl,
  };
}

const PNG = { name: "logo.png", type: "image/png", size: 10_000 };

describe("uploadLogo pre-network gates", () => {
  it.each([
    ["evil.exe", "application/octet-stream", "BAD_TYPE"],
    ["shell.png", "text/html", "BAD_TYPE"],
    ["noext", "image/png", "BAD_TYPE"],
  ])("rejects %s before any network call", async (name, type, reason) => {
    const f = fakeStorage();
    const res = await uploadLogo(f.deps, {
      businessId: "bid-1",
      file: { name, type, size: 100 },
    });
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error.reason).toBe(reason);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("rejects files over 1_000_000 bytes with TOO_LARGE", async () => {
    const f = fakeStorage();
    const res = await uploadLogo(f.deps, {
      businessId: "bid-1",
      file: { name: "big.png", type: "image/png", size: 1_000_001 },
    });
    if (!res.ok) expect(res.error.reason).toBe("TOO_LARGE");
    else throw new Error("expected rejection");
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("accepts svg/jpg/jpeg/png within the allowlist", async () => {
    const mimeFor: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      svg: "image/svg+xml",
    };
    for (const ext of ["png", "jpg", "jpeg", "svg"]) {
      const f = fakeStorage();
      const res = await uploadLogo(f.deps, {
        businessId: "bid-1",
        file: { name: `logo.${ext}`, type: mimeFor[ext]!, size: 500 },
      });
      expect(res.ok).toBe(true);
    }
  });

  it("builds the exact tenant path grammar and uploads with upsert+contentType", async () => {
    const f = fakeStorage();
    await uploadLogo(f.deps, {
      businessId: "9f0c8e2a-1111-2222-3333-444455556666",
      file: PNG,
    });
    expect(f.upload).toHaveBeenCalledWith(
      "businesses/9f0c8e2a-1111-2222-3333-444455556666/logo.png",
      expect.anything(),
      expect.objectContaining({ upsert: true, contentType: "image/png" }),
    );
  });

  it("maps storage failures to a typed union", async () => {
    const f = fakeStorage();
    f.upload.mockResolvedValueOnce({ data: null, error: { message: "bucket denied" } });
    const res = await uploadLogo(f.deps, { businessId: "bid-1", file: PNG });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("UNKNOWN");
  });
});

describe("remove/signed-url", () => {
  it("removes by the same tenant path for the CALLER-SUPPLIED extension (CR-04)", async () => {
    const f = fakeStorage();
    await removeLogo(f.deps, "bid-1", "png");
    expect(f.remove).toHaveBeenCalledWith(["businesses/bid-1/logo.png"]);
  });

  it("removes svg uploads at THEIR path - never a hardcoded .png", async () => {
    const f = fakeStorage();
    const res = await removeLogo(f.deps, "bid-1", "svg");
    expect(f.remove).toHaveBeenCalledWith(["businesses/bid-1/logo.svg"]);
    expect(res.ok).toBe(true);
  });

  it("maps storage failures to a failed result instead of silent success (CR-04)", async () => {
    const f = fakeStorage();
    f.remove.mockResolvedValueOnce({ data: null, error: { message: "bucket denied" } });
    const res = await removeLogo(f.deps, "bid-1", "jpg");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("UNKNOWN");
  });

  it("signs the caller-supplied extension's object for private rendering", async () => {
    const f = fakeStorage();
    const res = await createSignedLogoUrl(f.deps, "bid-1", "jpeg");
    expect(f.createSignedUrl).toHaveBeenCalledWith("businesses/bid-1/logo.jpeg", 300);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.signedUrl).toContain("https://");
  });

  it("keeps 300s expiry on png paths (regression)", async () => {
    const f = fakeStorage();
    await createSignedLogoUrl(f.deps, "bid-1", "png");
    expect(f.createSignedUrl).toHaveBeenCalledWith("businesses/bid-1/logo.png", 300);
  });
});
