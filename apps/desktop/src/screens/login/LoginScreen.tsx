// S1 Sign-in (UI-SPEC §S1) - the enumeration-resistant login surface.
//
// Copy rules (D-73/T-3-04):
//   * credential failures render GENERIC_CREDENTIALS_MESSAGE imported from
//     @billing/api/errors - NEVER re-typed here;
//   * ?reason= banners come from strings/global verbatim;
//   * zero signup language, no links, no logo wall.
// Geometry: centered 360px column on paper; app logo 48px + rotating quip; Display headline;
// full-width primary CTA h36; footer caption exact.

import { useState, type FormEvent, type FocusEvent, type KeyboardEvent } from "react";
import { AppLogo } from "../../components/brand/AppLogo";
import { APP_NAME, pickLoginPhrase } from "../../lib/strings/brand";
import { LoaderCircle } from "lucide-react";
import { GENERIC_CREDENTIALS_MESSAGE } from "@billing/api/errors";
import {
  ACCOUNT_DEACTIVATED_BANNER,
  ACCOUNT_LOCKED_BANNER,
  SESSION_ENDED_BANNER,
} from "../../lib/strings/global";
import {
  CTA_TRY_AGAIN,
  FIELD_EMAIL,
  FIELD_PASSWORD,
  FOOTER_CAPTION,
  NETWORK_FAILURE_MESSAGE,
  SIGN_IN_HEADING,
  SIGNING_IN,
} from "../../lib/strings/login";
import { useAuth } from "../../auth/AuthProvider";
import { CapsLockHint } from "./CapsLockHint";

export type LoginBannerTone = "warning" | "danger" | "info";

export interface LoginScreenProps {
  /** Redirect reason arriving with /login?reason=… (post-hoc taxonomy). */
  initialReason?: string;
  /** Intended destination captured by the route guard. */
  redirectTo?: string;
  /** Called after a session is adopted; receives the target path. */
  onAuthenticated: (targetPath: string) => void;
}

interface Banner {
  tone: LoginBannerTone;
  copy: string;
}

function reasonBanner(reason: string): Banner {
  switch (reason) {
    case "locked":
      return { tone: "danger", copy: ACCOUNT_LOCKED_BANNER };
    case "deactivated":
      return { tone: "danger", copy: ACCOUNT_DEACTIVATED_BANNER };
    case "ended":
      // Ended session is not the user's fault - warning tones, not danger.
      return { tone: "warning", copy: SESSION_ENDED_BANNER };
    default:
      return { tone: "danger", copy: GENERIC_CREDENTIALS_MESSAGE };
  }
}

const inputClasses =
  "h-(--control-md) w-full rounded-md border border-hairline-strong bg-surface px-sd text-body text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 transition-colors duration-(--duration-fast)";

export function LoginScreen({ initialReason, redirectTo, onAuthenticated }: LoginScreenProps) {
  const { signInWithPassword, adoptReturnedSession } = useAuth();
  // Easter egg: a different ledger quip on every visit to the sign-in screen.
  const [phrase] = useState(() => pickLoginPhrase());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(
    initialReason ? reasonBanner(initialReason) : null,
  );
  const [networkFailure, setNetworkFailure] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const trackCapsLock = (
    e: KeyboardEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>,
  ) => {
    // Structural probe: keyboard events expose getModifierState, focus events
    // may not - and jsdom lacks it entirely, so headless environments no-op.
    const gms = (e as unknown as { getModifierState?: (k: string) => boolean })
      .getModifierState;
    setCapsLockOn(typeof gms === "function" && gms.call(e, "CapsLock"));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNetworkFailure(false);
    try {
      const result = await signInWithPassword({ email, password });
      if (result.ok) {
        const adopted = await adoptReturnedSession(result.session);
        if (adopted.ok) {
          onAuthenticated(redirectTo ?? "/dashboard");
          return; // navigation hands off; the lock resets in finally for the next attempt
        }
        setBanner({ tone: "danger", copy: GENERIC_CREDENTIALS_MESSAGE });
      } else if (result.reason === "network") {
        setBanner({ tone: "warning", copy: NETWORK_FAILURE_MESSAGE });
        setNetworkFailure(true);
      } else {
        // invalid_credentials AND unknown_response both render the ONE
        // shared copy - never invent a lockout signal the server did not send.
        setBanner({ tone: "danger", copy: GENERIC_CREDENTIALS_MESSAGE });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const ctaLabel = networkFailure ? CTA_TRY_AGAIN : SIGN_IN_HEADING;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-md">
      <div className="w-(--width-login-column)">
        <div className="flex items-center gap-sd">
          <AppLogo size={48} />
          <span className="text-heading text-ink">{APP_NAME}</span>
        </div>
        <h1 className="mt-lg text-display text-ink">{SIGN_IN_HEADING}</h1>
        <p data-testid="login-phrase" className="mt-xs text-caption italic text-ink-secondary">
          {phrase}
        </p>

        <div className="mt-md" role="region" aria-label="message slot">
          {banner !== null && (
            <p
              role="alert"
              data-tone={banner.tone}
              className={
                banner.tone === "danger"
                  ? "rounded-md bg-danger-subtle px-sd py-sm text-body text-danger"
                  : banner.tone === "warning"
                    ? "rounded-md bg-warning-subtle px-sd py-sm text-body text-warning"
                    : "rounded-md bg-accent-subtle px-sd py-sm text-body text-accent-hover"
              }
            >
              {banner.copy}
            </p>
          )}
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="mt-md flex flex-col gap-sd" noValidate>
          <div>
            <label htmlFor="login-email" className="mb-xs block text-caption text-ink-secondary">
              {FIELD_EMAIL}
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={submitting}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-xs block text-caption text-ink-secondary">
              {FIELD_PASSWORD}
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={submitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={trackCapsLock}
              onKeyUp={trackCapsLock}
              onFocus={trackCapsLock}
              aria-invalid={banner?.tone === "danger" || undefined}
              className={inputClasses}
            />
            <CapsLockHint active={capsLockOn} />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="mt-sm inline-flex h-(--control-lg) w-full items-center justify-center gap-xs rounded-md bg-accent text-body font-semibold text-white transition-colors duration-(--duration-fast) hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {submitting ? (
              <>
                <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />
                {SIGNING_IN}
              </>
            ) : (
              ctaLabel
            )}
          </button>
        </form>

        <p className="mt-xl text-center text-caption text-ink-secondary">{FOOTER_CAPTION}</p>
      </div>
    </main>
  );
}
