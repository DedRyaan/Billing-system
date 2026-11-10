// S2 First-run bootstrap (UI-SPEC §S2) wired to bootstrap-super-admin.
//
// SPEC DEVIATION (pre-resolved by the plan, recorded in the summary): the
// spec sketch shows a setup-code-only card, but bootstrap-super-admin mints
// the owner account and REQUIRES {email, password, full_name, setup_code}.
// The function contract is binding - this card groups all four compactly
// under the headline while keeping every other visual contract intact.

import { useState, type FormEvent } from "react";
import { AppLogo } from "../../components/brand/AppLogo";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import type { GoTrueSessionJSON } from "@billing/api/auth";
import {
  BOOTSTRAP_BODY,
  BOOTSTRAP_CTA,
  BOOTSTRAP_ERROR_COPY,
  BOOTSTRAP_HEADING,
  FIELD_EMAIL,
  FIELD_FULL_NAME,
  FIELD_PASSWORD,
  FIELD_SETUP_CODE,
  HIDE_CODE_LABEL,
  NETWORK_FAILURE_MESSAGE,
  REVEAL_CODE_LABEL,
} from "../../lib/strings/login";
import { setBootstrapState } from "../../lib/session-seam";

export interface BootstrapScreenProps {
  /** Injectable transport (tests script outcomes); default: client.functions.invoke. */
  invoke: (fn: string, opts?: { body?: unknown }) => Promise<unknown>;
  /** Injectable session adoption (tests assert; production uses useAuth). */
  adoptSession: (sessionJson: GoTrueSessionJSON) => Promise<{ ok: boolean }>;
  /** Handoff after mint - route navigates to /businesses (empty state IS the welcome mat). */
  onBootstrapped: () => void;
}

interface InvokeEnvelope<T> {
  data: T | null;
  error: unknown;
}

const inputClasses =
  "h-(--control-md) w-full rounded-md border border-hairline-strong bg-surface px-sd text-body text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-colors duration-(--duration-fast)";

export function BootstrapScreen({
  invoke,
  adoptSession,
  onBootstrapped,
}: BootstrapScreenProps) {
  const [setupCode, setSetupCode] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorCopy, setErrorCopy] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorCopy(null);
    try {
      const envelope = (await invoke("bootstrap-super-admin", {
        body: {
          action: "bootstrap",
          email: email.trim().toLowerCase(),
          password,
          full_name: fullName.trim(),
          setup_code: setupCode,
        },
      })) as InvokeEnvelope<{ session?: GoTrueSessionJSON }>;

      if (envelope.error) {
        const body = await extractBody(envelope.error);
        if (body === "invalid_setup_code") {
          setErrorCopy(BOOTSTRAP_ERROR_COPY);
        } else if (body === "network") {
          setErrorCopy(NETWORK_FAILURE_MESSAGE);
        } else {
          // Payload/seed/profile failures are server-side truths; keep calm
          // and honest without inventing detail we do not have.
          setErrorCopy(BOOTSTRAP_ERROR_COPY);
        }
        return;
      }

      const sessionJson = envelope.data?.session;
      if (!sessionJson || typeof sessionJson.access_token !== "string") {
        setErrorCopy(NETWORK_FAILURE_MESSAGE);
        return;
      }
      const adopted = await adoptSession(sessionJson);
      if (!adopted.ok) {
        setErrorCopy(NETWORK_FAILURE_MESSAGE);
        return;
      }
      // D-73: bootstrapped forever - /bootstrap becomes unreachable.
      setBootstrapState("bootstrapped");
      onBootstrapped();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-md">
      <div className="w-(--width-bootstrap-card) rounded-xl border border-hairline bg-surface p-xl">
        <AppLogo size={48} />
        <h1 className="mt-lg text-display text-ink">{BOOTSTRAP_HEADING}</h1>
        <p className="mt-sm text-body text-ink-secondary">{BOOTSTRAP_BODY}</p>

        <div className="mt-md" role="region" aria-label="message slot">
          {errorCopy !== null && (
            <p
              role="alert"
              data-tone="danger"
              className="rounded-md bg-danger-subtle px-sd py-sm text-body text-danger"
            >
              {errorCopy}
            </p>
          )}
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="mt-md flex flex-col gap-sd" noValidate>
          <div>
            <label htmlFor="bs-code" className="mb-xs block text-caption text-ink-secondary">
              {FIELD_SETUP_CODE}
            </label>
            <div className="relative">
              <input
                id="bs-code"
                name="setup_code"
                type={revealed ? "text" : "password"}
                autoComplete="off"
                required
                disabled={submitting}
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                className={`${inputClasses} pr-(--spacing-lg) font-mono tracking-wide`}
              />
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? HIDE_CODE_LABEL : REVEAL_CODE_LABEL}
                className="absolute inset-y-0 right-0 flex w-(--control-md) items-center justify-center text-ink-secondary hover:text-ink"
              >
                {revealed ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {/* Mint-payload fields (deviation): compact group under the code. */}
          <div className="grid grid-cols-2 gap-sd">
            <div>
              <label htmlFor="bs-email" className="mb-xs block text-caption text-ink-secondary">
                {FIELD_EMAIL}
              </label>
              <input
                id="bs-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="bs-name" className="mb-xs block text-caption text-ink-secondary">
                {FIELD_FULL_NAME}
              </label>
              <input
                id="bs-name"
                name="full_name"
                type="text"
                autoComplete="name"
                required
                disabled={submitting}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputClasses}
              />
            </div>
          </div>
          <div>
            <label htmlFor="bs-password" className="mb-xs block text-caption text-ink-secondary">
              {FIELD_PASSWORD}
            </label>
            <input
              id="bs-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              disabled={submitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClasses}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="mt-sm inline-flex h-(--control-lg) w-full items-center justify-center gap-xs rounded-md bg-accent text-body font-semibold text-white transition-colors duration-(--duration-fast) hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {submitting ? (
              <>
                <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />
                {BOOTSTRAP_CTA}
              </>
            ) : (
              BOOTSTRAP_CTA
            )}
          </button>
        </form>
      </div>
    </main>
  );
}

async function extractBody(error: unknown): Promise<string> {
  const candidate = error as { context?: { json?: () => Promise<unknown> }; message?: string };
  if (candidate?.context?.json) {
    try {
      const body = (await candidate.context.json()) as { error?: { code?: string } };
      return typeof body.error?.code === "string" ? body.error.code : "unknown";
    } catch {
      return "unknown";
    }
  }
  if (typeof candidate?.message === "string" && /fetch/i.test(candidate.message)) {
    return "network";
  }
  return "unknown";
}
