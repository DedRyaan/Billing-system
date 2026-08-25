// Logo storage module (BIZ-01/D-77, T-3-01/02 posture): uploads are
// path-scoped to the authenticated businessId using the SAME grammar the 0017
// policies enforce - businesses/{businessId}/logo.{ext} - so a crafted key can
// never escape tenant scope. Type/size gates run BEFORE any network call.
//
// deps injection keeps this framework- and env-free: pass { storage } from
// createBillingClient(...).storage in screens; tests script doubles.

import type { DataAccessError } from "./errors";

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "svg"]);
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml", // canonical
  "image/jpg", // legacy alias seen from some cameras
]);
const MAX_LOGO_BYTES = 1_000_000;

export interface LogoFile {
  name: string;
  type: string;
  size: number;
}

/** Structural subset of supabase-js StorageClient used here. */
export interface LogoStorageDeps {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: unknown,
        opts?: { upsert?: boolean; contentType?: string },
      ): Promise<{ data: unknown; error: unknown }>;
      remove(paths: string[]): Promise<{ data: unknown; error: unknown }>;
      createSignedUrl(path: string, expires: number): Promise<{ data: unknown; error: unknown }>;
    };
  };
}

type UploadFailureReason = "BAD_TYPE" | "TOO_LARGE";
export type LogoGateError = { reason: UploadFailureReason; message: string };

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

/**
 * Pre-network validation. Returns the gate error (BAD_TYPE / TOO_LARGE) or
 * null when the file may proceed.
 */
export function validateLogoFile(file: LogoFile): LogoGateError | null {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME.has(file.type.toLowerCase())) {
    return { reason: "BAD_TYPE", message: "Logo must be a png, jpg/jpeg or svg image." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { reason: "TOO_LARGE", message: "Logo must be 1 MB or smaller." };
  }
  return null;
}

export function logoPath(businessId: string, ext: string): string {
  return `businesses/${businessId}/logo.${ext}`;
}

export type LogoUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: LogoGateError | DataAccessError };

export async function uploadLogo(
  deps: LogoStorageDeps,
  args: { businessId: string; file: LogoFile },
): Promise<LogoUploadResult> {
  const gate = validateLogoFile(args.file);
  if (gate) return { ok: false, error: gate };

  const ext = extensionOf(args.file.name);
  const path = logoPath(args.businessId, ext);
  try {
    const res = await deps.storage.from("logos").upload(path, args.file, {
      upsert: true,
      contentType: args.file.type,
    });
    if (res.error) {
      return {
        ok: false,
        error: { reason: "UNKNOWN", message: (res.error as { message?: string }).message ?? "upload failed" },
      };
    }
    return { ok: true, path };
  } catch (err) {
    void err;
    return { ok: false, error: { reason: "NETWORK" as const, message: "Upload failed - check connection." } };
  }
}

/** Remove by the same tenant grammar (idempotent best-effort). */
export async function removeLogo(deps: LogoStorageDeps, businessId: string): Promise<LogoUploadResult> {
  try {
    const res = await deps.storage.from("logos").remove([logoPath(businessId, "png")]);
    void res;
    return { ok: true, path: logoPath(businessId, "png") };
  } catch {
    return { ok: false, error: { reason: "NETWORK" as const, message: "Removal failed." } };
  }
}

export interface SignedUrlPayload {
  signedUrl: string;
}

export async function createSignedLogoUrl(
  deps: LogoStorageDeps,
  businessId: string,
  expiresInSeconds = 300,
): Promise<
  | { ok: true; data: SignedUrlPayload }
  | { ok: false; error: DataAccessError }
> {
  const { toDataAccessError } = await import("./errors");
  try {
    const res = await deps.storage
      .from("logos")
      .createSignedUrl(logoPath(businessId, "png"), expiresInSeconds);
    if (res.error) return { ok: false, error: toDataAccessError(res.error) };
    const data = res.data as { signedUrl?: string };
    if (!data?.signedUrl) {
      return { ok: false, error: { reason: "UNKNOWN", message: "No signed URL returned." } };
    }
    return { ok: true, data: { signedUrl: data.signedUrl } };
  } catch (err) {
    return { ok: false, error: toDataAccessError(err) };
  }
}
