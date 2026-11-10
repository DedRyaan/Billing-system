// Email sign-in (magic link) and forgot-password flows for the sign-in screen.
//
// Step 1 sends the email; step 2 waits for either the link (handled by
// AuthProvider's settle:// listener) or the code typed here. Both emails carry
// both, so a person who read the email on their phone can still finish.

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import {
  sendPasswordResetEmail,
  sendSignInEmail,
  verifyEmailCode,
  type EmailSendResult,
} from "@billing/api/email-auth";
import { useAuth } from "../../auth/AuthProvider";
import {
  BACK_TO_SIGN_IN,
  CODE_RESET_CTA,
  CODE_SIGN_IN_CTA,
  EMAIL_REQUIRED,
  EMAIL_SIGN_IN_BODY,
  EMAIL_SIGN_IN_CTA,
  ENTER_CODE_NOTICE,
  FIELD_CODE,
  FIELD_EMAIL,
  HAVE_CODE_LINK,
  INVALID_CODE_MESSAGE,
  NETWORK_FAILURE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  RESEND_EMAIL,
  RESET_BODY,
  RESET_CTA,
  SENDING,
  USE_DIFFERENT_EMAIL,
  VERIFYING,
  emailSentNotice,
  resendIn,
} from "../../lib/strings/login";

export type EmailAuthMode = "magic" | "reset";

const RESEND_COOLDOWN_S = 60;

const inputClasses =
  "h-(--control-md) w-full rounded-md border border-hairline-strong bg-surface px-sd text-body text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-colors duration-(--duration-fast)";
const primaryClasses =
  "mt-sm inline-flex h-(--control-lg) w-full items-center justify-center gap-xs rounded-md bg-accent text-body font-semibold text-white transition-colors duration-(--duration-fast) hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const textButtonClasses =
  "cursor-pointer text-caption text-accent hover:text-accent-hover hover:underline disabled:pointer-events-none disabled:text-ink-muted";

function failureCopy(reason: "rate_limited" | "network" | "invalid_code"): string {
  if (reason === "rate_limited") return RATE_LIMITED_MESSAGE;
  if (reason === "network") return NETWORK_FAILURE_MESSAGE;
  return INVALID_CODE_MESSAGE;
}

export interface EmailAuthPanelProps {
  mode: EmailAuthMode;
  initialEmail: string;
  onBack: (email: string) => void;
  onAuthenticated: () => void;
}

export function EmailAuthPanel({ mode, initialEmail, onBack, onAuthenticated }: EmailAuthPanelProps) {
  const auth = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<"email" | "code">("email");
  // True when step 2 was reached by sending (vs "Already have a code?").
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (): Promise<boolean> => {
    if (auth.client === null) {
      setError(NETWORK_FAILURE_MESSAGE);
      return false;
    }
    setBusy(true);
    setError(null);
    auth.clearLinkNotice?.();
    const res: EmailSendResult =
      mode === "magic"
        ? await sendSignInEmail(auth.client, email)
        : await sendPasswordResetEmail(auth.client, email);
    setBusy(false);
    if (!res.ok) {
      setError(failureCopy(res.reason));
      return false;
    }
    setSent(true);
    setCooldown(RESEND_COOLDOWN_S);
    return true;
  };

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (email.trim() === "") {
      setError(EMAIL_REQUIRED);
      return;
    }
    if (await send()) setStep("code");
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || auth.client === null) return;
    setBusy(true);
    setError(null);
    const res = await verifyEmailCode(auth.client, {
      email,
      code,
      purpose: mode === "reset" ? "recovery" : "sign_in",
    });
    if (!res.ok) {
      setBusy(false);
      setError(failureCopy(res.reason));
      return;
    }
    const adopted = await auth.adoptEmailSession(res.session, { recovery: mode === "reset" });
    setBusy(false);
    if (!adopted.ok) {
      setError(INVALID_CODE_MESSAGE);
      return;
    }
    onAuthenticated();
  };

  const alert =
    error !== null ? (
      <p role="alert" className="rounded-md bg-danger-subtle px-sd py-sm text-body text-danger">
        {error}
      </p>
    ) : null;

  if (step === "email") {
    return (
      <>
        <p className="mt-xs text-body text-ink-secondary">
          {mode === "magic" ? EMAIL_SIGN_IN_BODY : RESET_BODY}
        </p>
        <div className="mt-md">{alert}</div>
        <form onSubmit={(e) => void onSend(e)} className="mt-md flex flex-col gap-sd" noValidate>
          <div>
            <label htmlFor="email-auth-email" className="mb-xs block text-caption text-ink-secondary">
              {FIELD_EMAIL}
            </label>
            <input
              id="email-auth-email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClasses}
            />
          </div>
          <button type="submit" disabled={busy} className={primaryClasses}>
            {busy ? (
              <>
                <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />
                {SENDING}
              </>
            ) : mode === "magic" ? (
              EMAIL_SIGN_IN_CTA
            ) : (
              RESET_CTA
            )}
          </button>
        </form>
        <div className="mt-md flex items-center justify-between">
          <button type="button" className={textButtonClasses} onClick={() => onBack(email)}>
            {BACK_TO_SIGN_IN}
          </button>
          {mode === "reset" && (
            <button
              type="button"
              className={textButtonClasses}
              onClick={() => {
                if (email.trim() === "") {
                  setError(EMAIL_REQUIRED);
                  return;
                }
                setError(null);
                setSent(false);
                setStep("code");
              }}
            >
              {HAVE_CODE_LINK}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <p
        role="status"
        className="mt-md rounded-md bg-accent-subtle px-sd py-sm text-body text-accent-hover"
      >
        {sent ? emailSentNotice(email.trim()) : ENTER_CODE_NOTICE}
      </p>
      <div className="mt-md">{alert}</div>
      <form onSubmit={(e) => void onVerify(e)} className="mt-md flex flex-col gap-sd" noValidate>
        <div>
          <label htmlFor="email-auth-code" className="mb-xs block text-caption text-ink-secondary">
            {FIELD_CODE}
          </label>
          <input
            id="email-auth-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={12}
            disabled={busy}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${inputClasses} font-mono tracking-[0.3em]`}
          />
        </div>
        <button type="submit" disabled={busy || code.trim() === ""} className={primaryClasses}>
          {busy ? (
            <>
              <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />
              {VERIFYING}
            </>
          ) : mode === "magic" ? (
            CODE_SIGN_IN_CTA
          ) : (
            CODE_RESET_CTA
          )}
        </button>
      </form>
      <div className="mt-md flex flex-wrap items-center justify-between gap-sm">
        <button
          type="button"
          className={textButtonClasses}
          onClick={() => {
            setCode("");
            setError(null);
            setStep("email");
          }}
        >
          {USE_DIFFERENT_EMAIL}
        </button>
        <button
          type="button"
          className={textButtonClasses}
          disabled={busy || cooldown > 0}
          onClick={() => void send()}
        >
          {cooldown > 0 ? resendIn(cooldown) : RESEND_EMAIL}
        </button>
      </div>
      <button
        type="button"
        className={`mt-md ${textButtonClasses}`}
        onClick={() => onBack(email)}
      >
        {BACK_TO_SIGN_IN}
      </button>
    </>
  );
}
