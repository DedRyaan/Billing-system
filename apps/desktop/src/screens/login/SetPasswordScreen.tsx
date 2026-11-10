// SetPasswordScreen - shown instead of the app shell while the signed-in
// profile carries must_change_password (admin-issued temporary password).
// The person picks their own password; on success the flag clears and the
// profile refresh lets the shell render.
import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { setOwnPassword } from "@billing/api/memberships";
import { useAuth } from "../../auth/AuthProvider";
import { AppLogo } from "../../components/brand/AppLogo";
import { CONTROL_CLASSES } from "../../components/ui/Input";

const MIN_PASSWORD_LENGTH = 8;

export function SetPasswordScreen() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const firstName = (auth.profile?.full_name ?? "").split(" ")[0] ?? "";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || auth.client === null) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await setOwnPassword(auth.client, password);
    if (!res.ok) {
      setSaving(false);
      setError(res.error.message);
      return;
    }
    await auth.refreshProfile();
    setSaving(false);
  };

  const inputClasses = `h-(--control-lg) ${CONTROL_CLASSES}`;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-md">
      <div className="w-(--width-login-column)">
        <AppLogo size={48} />
        <h1 className="mt-lg text-display text-ink">Choose your password</h1>
        <p className="mt-xs text-body text-ink-secondary">
          {firstName !== "" ? `Welcome, ${firstName}. ` : ""}You signed in with a temporary password.
          Pick one only you know to continue.
        </p>

        {error !== null && (
          <p role="alert" className="mt-md rounded-md bg-danger-subtle px-sd py-sm text-body text-danger">
            {error}
          </p>
        )}

        <form onSubmit={(e) => void onSubmit(e)} className="mt-md flex flex-col gap-sd" noValidate>
          <div>
            <label htmlFor="new-password" className="mb-xs block text-caption text-ink-secondary">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={saving}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-xs block text-caption text-ink-secondary">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              disabled={saving}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClasses}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-sm inline-flex h-(--control-lg) w-full items-center justify-center gap-xs rounded-md bg-accent text-body font-semibold text-white transition-colors duration-(--duration-fast) hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {saving ? (
              <>
                <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />
                Saving…
              </>
            ) : (
              "Save and continue"
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void auth.signOut()}
          className="mt-lg w-full cursor-pointer text-center text-caption text-ink-secondary underline"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
