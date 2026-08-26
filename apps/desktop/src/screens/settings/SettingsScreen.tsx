// SettingsScreen - S8 assembly (plan 03-10 Task 3, AUTH-05/D-71).
// Hairline-separated sections: Account (read-only) · Team (admins only -
// staff variant NEVER mounts it, T-3-40) · Session (sign-out duplicate -
// D-71 every-screen reachability) · About (version via Tauri API with a
// static dev fallback) · the quiet footer note.
import { useEffect, useState } from "react";
import { HeaderRow } from "../../shell/HeaderRow";
import { Button } from "../../components/ui/Button";
import { initialsOf } from "../../shell/UserFooter";
import { Badge } from "../../components/ui/Badge";
import { useAuth } from "../../auth/AuthProvider";
import { TeamSection } from "../team/TeamSection";
import {
  ABOUT_APP_NAME,
  ABOUT_VERSION_FALLBACK,
  SECTION_ABOUT,
  SECTION_ACCOUNT,
  SECTION_SESSION,
  SECTION_TEAM,
  QUIET_FOOTER_NOTE,
  SETTINGS_SCREEN_TITLE,
  SIGN_OUT_BUTTON,
  aboutVersionLabel,
} from "../../lib/strings/settings";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-caption uppercase tracking-[0.04em] text-ink-secondary">
      {children}
    </h2>
  );
}

async function readAppVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return ABOUT_VERSION_FALLBACK;
  }
}

export function SettingsScreen() {
  const auth = useAuth();
  const [version, setVersion] = useState<string>(ABOUT_VERSION_FALLBACK);

  useEffect(() => {
    let mounted = true;
    void readAppVersion().then((v) => {
      if (mounted) setVersion(v);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Server-controlled role predicate - admins manage teams.
  const isAdminArea = auth.role === "admin" || auth.role === "super_admin";
  const roleCaption = auth.role === "staff" ? "Staff" : "Admin";

  return (
    <>
      <HeaderRow title={SETTINGS_SCREEN_TITLE} />
      <div className="flex min-h-0 flex-1 flex-col gap-xl px-lg py-lg">
        {/* ACCOUNT */}
        <section aria-label={SECTION_ACCOUNT} className="flex flex-col gap-sd">
          <SectionHeading>{SECTION_ACCOUNT}</SectionHeading>
          <div className="flex items-center gap-sd" data-testid="account-block">
            <span
              aria-hidden="true"
              data-testid="settings-avatar"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-subtle text-body font-semibold text-accent-hover"
            >
              {initialsOf(auth.profile?.full_name ?? null, auth.profile?.email ?? null)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-heading text-ink">
                {auth.profile?.full_name ?? "Account"}
              </span>
              <span className="block text-caption text-ink-secondary">
                {auth.profile?.email ?? ""}
              </span>
            </span>
            <span className="ml-auto shrink-0">
              <Badge tone={auth.role === "staff" ? "accent" : "neutral"}>{roleCaption}</Badge>
            </span>
          </div>
        </section>

        {/* TEAM - admins only; staff variant mounts NOTHING (T-3-40). */}
        {isAdminArea && (
          <section aria-label={SECTION_TEAM} className="flex flex-col gap-sd" data-testid="team-section">
            <SectionHeading>{SECTION_TEAM}</SectionHeading>
            <TeamSection client={auth.client} />
          </section>
        )}

        {/* SESSION */}
        <section aria-label={SECTION_SESSION} className="flex flex-col gap-sd">
          <SectionHeading>{SECTION_SESSION}</SectionHeading>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void auth.signOut()}
              data-testid="settings-signout"
              className="!text-danger hover:!bg-danger-subtle"
            >
              {SIGN_OUT_BUTTON}
            </Button>
          </div>
        </section>

        {/* ABOUT */}
        <section aria-label={SECTION_ABOUT} className="flex flex-col gap-sd">
          <SectionHeading>{SECTION_ABOUT}</SectionHeading>
          <div className="flex items-center gap-sm" data-testid="about-block">
            <img src="/branding/tile-mark-light.svg" alt="" width={20} height={20} aria-hidden="true" />
            <span className="text-body text-ink">{ABOUT_APP_NAME}</span>
            <span className="text-caption text-ink-secondary" data-testid="about-version">
              {aboutVersionLabel(version)}
            </span>
          </div>
        </section>

        <p className="text-caption text-ink-muted">{QUIET_FOOTER_NOTE}</p>
      </div>
    </>
  );
}
