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

// Email sign-in (magic link) + forgot password. Every email carries a link
// AND a code; the copy always offers both. Sending never says whether an
// account exists for the address.
export const FORGOT_PASSWORD_LINK = "Forgot password?";
export const EMAIL_SIGN_IN_LINK = "Email me a sign-in link instead";
export const BACK_TO_SIGN_IN = "Back to sign in";
export const EMAIL_SIGN_IN_HEADING = "Sign in with email";
export const EMAIL_SIGN_IN_BODY =
  "We'll email you a link that signs you in, plus a code you can type here instead.";
export const EMAIL_SIGN_IN_CTA = "Email me a link";
export const RESET_HEADING = "Reset your password";
export const RESET_BODY =
  "We'll email you a link to choose a new password, plus a code you can type here instead.";
export const RESET_CTA = "Send reset email";
export const HAVE_CODE_LINK = "Already have a code?";
export const SENDING = "Sending…";
export const FIELD_CODE = "Code from the email";
export const CODE_SIGN_IN_CTA = "Sign in";
export const CODE_RESET_CTA = "Continue";
export const VERIFYING = "Checking…";
export const RESEND_EMAIL = "Send another email";
export const resendIn = (seconds: number): string => `Send another email in ${seconds}s`;
export const USE_DIFFERENT_EMAIL = "Use a different email";
export const emailSentNotice = (email: string): string =>
  `If an account exists for ${email}, an email is on its way. Open the link in it on this computer, or type the code below.`;
export const ENTER_CODE_NOTICE = "Type the code from your password-reset email.";
export const EMAIL_REQUIRED = "Enter your email address.";
export const INVALID_CODE_MESSAGE = "That code is wrong or has expired. Check the email, or send a new one.";
export const RATE_LIMITED_MESSAGE =
  "Too many emails or attempts just now. Wait a few minutes, then try again.";
