// LogoUploadField - the S4 logo contract (plan 03-07 Task 3, T-3-26).
// 128x88 dashed drop-zone -> filled 64px circle preview via signedUrl ->
// Replace/Remove text-buttons; type/size gates run BEFORE any network call;
// 4px accent progress bar during flight; failure toast w/ Retry re-running
// the SAME file. The image renders ONLY through <img src=signedUrl> - never
// inline SVG markup, so script-bearing uploads cannot execute in the DOM.
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import {
  createSignedLogoUrl,
  removeLogo,
  uploadLogo,
  validateLogoFile,
  type LogoStorageDeps,
} from "@billing/api/logos";
import { showMutationFailure } from "../../shell/toast-store";
import {
  LOGO_CAPTION,
  LOGO_REMOVE,
  LOGO_REPLACE,
  logoGateCaption,
} from "../../lib/strings/businesses";

export interface LogoUploadFieldProps {
  deps: LogoStorageDeps;
  businessId: string;
  existingPath: string | null;
  disabled?: boolean;
  onUploaded: (path: string) => void;
  onRemoved: () => void;
}

/** Extension from a stored/uploaded logo path ("businesses/{id}/logo.svg" -> "svg"). */
function extensionFromPath(path: string | null): string | null {
  if (path === null) return null;
  const idx = path.lastIndexOf(".");
  if (idx === -1) return null;
  const ext = path.slice(idx + 1).toLowerCase();
  return ext.length > 0 ? ext : null;
}

export function LogoUploadField({
  deps,
  businessId,
  existingPath,
  disabled = false,
  onUploaded,
  onRemoved,
}: LogoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const lastFileRef = useRef<File | null>(null);
  // CR-04: the freshest known object path. An upload result wins until the
  // parent's persisted logo_path propagates back down; the signed URL and
  // Remove then target the REAL extension instead of a hardcoded .png.
  const [localPath, setLocalPath] = useState<string | null>(null);
  const effectivePath = localPath ?? existingPath;

  const signFor = useCallback(
    async (path: string | null) => {
      const ext = extensionFromPath(path);
      if (ext === null) {
        setSignedUrl(null);
        return;
      }
      const res = await createSignedLogoUrl(deps, businessId, ext);
      setSignedUrl(res.ok ? res.data.signedUrl : null);
    },
    [deps, businessId],
  );

  useEffect(() => {
    void signFor(effectivePath);
  }, [signFor, effectivePath]);

  const runUpload = async (file: File) => {
    if (uploading) return;
    // Pre-network gates FIRST (T-3-26): extension+MIME allowlist and 1MB cap.
    const gate = validateLogoFile({ name: file.name, type: file.type, size: file.size });
    if (gate !== null) {
      setGateError(logoGateCaption(gate.reason));
      return;
    }
    setGateError(null);
    setUploading(true);
    try {
      const res = await uploadLogo(deps, {
        businessId,
        file: { name: file.name, type: file.type, size: file.size },
      });
      if (res.ok) {
        lastFileRef.current = file;
        setLocalPath(res.path);
        onUploaded(res.path);
        await signFor(res.path);
      } else if ("reason" in res.error && (res.error.reason === "NETWORK" || res.error.reason === "UNKNOWN")) {
        showMutationFailure("logo", () => {
          if (lastFileRef.current !== null) void runUpload(lastFileRef.current);
          else if (file !== null) void runUpload(file);
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const pickFile = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || disabled) return;
    void runUpload(file);
  };

  const handleRemove = async () => {
    // CR-04: remove the REAL object (extension from the known path) and map
    // storage errors to the failure toast - never a silent no-op success.
    const res = await removeLogo(deps, businessId, extensionFromPath(effectivePath) ?? "");
    if (!res.ok) {
      showMutationFailure("logo", () => void handleRemove());
      return;
    }
    setLocalPath(null);
    onRemoved();
    setSignedUrl(null);
  };

  return (
    <div data-testid="logo-upload">
      {signedUrl !== null ? (
        <div className="flex items-center gap-sd">
          {/* ONLY render through <img>: no inline SVG markup anywhere. */}
          <img
            src={signedUrl}
            alt="Business logo preview"
            width={64}
            height={64}
            data-testid="logo-preview"
            className="h-16 w-16 rounded-full border border-hairline object-cover"
          />
          <div className="flex flex-col gap-xs">
            {!disabled && (
              <>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="text-caption text-accent-hover underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {LOGO_REPLACE}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={uploading}
                  className="text-caption text-ink-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {LOGO_REMOVE}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="logo-dropzone"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            if (!disabled) e.preventDefault();
          }}
          onDrop={(e) => {
            if (disabled) return;
            e.preventDefault();
            pickFile(e.dataTransfer.files);
          }}
          className="flex h-[88px] w-32 flex-col items-center justify-center gap-xs rounded-md border border-dashed border-hairline-strong bg-surface text-ink-secondary transition-colors duration-(--duration-fast) hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <ImagePlus size={20} aria-hidden="true" />
          <span className="px-xs text-center text-caption">{LOGO_CAPTION}</span>
        </button>
      )}

      {uploading && (
        <div
          aria-hidden="true"
          data-testid="logo-progress"
          className="mt-xs h-1 w-32 overflow-hidden rounded-sm bg-paper"
        >
          <div className="h-full w-full animate-skeleton-pulse bg-accent" />
        </div>
      )}

      {gateError !== null && (
        <p role="alert" className="mt-xs text-caption text-danger">
          {gateError}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
        hidden
        onChange={(e) => {
          pickFile(e.target.files);
          e.target.value = ""; // allow re-picking the same file after failure
        }}
      />
    </div>
  );
}
