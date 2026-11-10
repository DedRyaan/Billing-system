// S8 Settings strings - UI-SPEC Copywriting rows owned by plan 03-10.
import { RETRY } from "./global";

export const SETTINGS_SCREEN_TITLE = "Settings";

export const SECTION_ACCOUNT = "Account";
export const SECTION_TEAM = "Team";
export const SECTION_SESSION = "Session";
export const SECTION_ABOUT = "About";

export const SIGN_OUT_BUTTON = "Sign out";
/** Static fallback when @tauri-apps/api app.getVersion is unavailable (browser dev). */
export const ABOUT_APP_NAME = "Settle";
export const ABOUT_VERSION_FALLBACK = "dev";
export const aboutVersionLabel = (version: string): string => `Version ${version}`;

/** Quiet footer note - VERBATIM. */
export const QUIET_FOOTER_NOTE = "More settings arrive in later phases.";

export { RETRY };
