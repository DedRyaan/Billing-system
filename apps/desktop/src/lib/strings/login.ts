// S1 + S2 copy verbatim from UI-SPEC (§Copywriting per-screen rows).
// Global banner strings live in strings/global.ts; this module owns ONLY the
// auth screens' own copy.

export const SIGN_IN_HEADING = "Sign in";
export const FIELD_EMAIL = "Email";
export const FIELD_PASSWORD = "Password";
export const FOOTER_CAPTION = "Accounts are created by invitation by an admin.";
export const NETWORK_FAILURE_MESSAGE =
  "Couldn't reach the server. Check your connection and try again.";
export const CTA_TRY_AGAIN = "Try again";
export const SIGNING_IN = "Signing in…";

export const BOOTSTRAP_HEADING = "Set up your workspace";
export const BOOTSTRAP_BODY =
  "Enter the owner's setup code to create the first admin account. This screen appears only until setup completes.";
export const FIELD_SETUP_CODE = "Setup code";
export const FIELD_FULL_NAME = "Full name";
export const BOOTSTRAP_CTA = "Set up owner account";
export const BOOTSTRAP_ERROR_COPY = "That setup code didn't work. Check it and try again.";
export const REVEAL_CODE_LABEL = "Reveal setup code";
export const HIDE_CODE_LABEL = "Hide setup code";
