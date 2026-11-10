// S7 Team strings - UI-SPEC Copywriting rows owned by plan 03-10.
import { RETRY } from "./global";

export const TEAM_SECTION_TITLE = "Team";
export const TEAM_SEARCH_PLACEHOLDER = "Search name or email";

export const COL_PERSON = "Person";
export const COL_EMAIL = "Email";
export const COL_ROLE = "Role";
export const ROLE_BADGE_ADMIN = "Admin";
export const ROLE_BADGE_STAFF = "Staff";
export const COL_BUSINESSES = "Businesses";
export const COL_STATUS = "Status";
export const STATUS_ACTIVE = "Active";
export const STATUS_DEACTIVATED = "Deactivated";

// Membership chips - VERBATIM honesty microcopy (D-78).
export const MEMBERSHIP_MICROCOPY =
  "Changes take effect shortly — at your teammate's next app refresh.";
export const MEMBERSHIP_GROUP_LABEL = "Business memberships";
export const ARCHIVED_CHIP_SUFFIX = "(archived)";

// Zero-membership empty state - VERBATIM.
export const ZERO_ASSIGNMENTS_TITLE = "Not assigned anywhere";
export const ZERO_ASSIGNMENTS_BODY = "Toggle businesses below to give this person access.";

// Sheet identity block.
export const PERSON_SHEET_TITLE_PREFIX = "Member";

// Deactivate/reactivate confirms - VERBATIM (S7).
export const deactivateConfirmTitle = (name: string): string => `Deactivate ${name}?`;
export const DEACTIVATE_CONFIRM_BODY =
  "They'll be signed out everywhere within seconds and can't sign in until reactivated. Their name stays on past bills.";
export const DEACTIVATE_CONFIRM_VERB = "Deactivate account";
export const reactivateConfirmTitle = (name: string): string => `Reactivate ${name}?`;
export const REACTIVATE_CONFIRM_BODY =
  "They regain access to their assigned businesses on next sign-in.";
export const REACTIVATE_CONFIRM_VERB = "Reactivate";
export const DEACTIVATE_BUTTON = "Deactivate…";
export const REACTIVATE_BUTTON = "Reactivate…";

/**
 * D-11 scope note: admins manage STAFF rows only this phase. Super-admin
 * managing other admins is OUT OF SCOPE - the control stays hidden with this
 * comment as its documentation (mirror-not-authority of 0007 policy shape).
 * Locked accounts surface NO unlock control this phase (documented opt-out;
 * COVERAGE OPT-OUT).
 */

// Add staff + password reset (one-time temporary passwords).
export const ADD_STAFF_BUTTON = "Add staff";
export const ADD_STAFF_SHEET_TITLE = "Add staff member";
export const ADD_STAFF_SHEET_SUBTITLE =
  "They'll get a temporary password from you and choose their own at first sign-in.";
export const ADD_STAFF_NAME_LABEL = "Full name";
export const ADD_STAFF_EMAIL_LABEL = "Email";
export const ADD_STAFF_BUSINESSES_LABEL = "Businesses they can bill for";
export const ADD_STAFF_CREATED_TITLE = "Staff member added";
export const RESET_PASSWORD_BUTTON = "Reset password…";
export const resetPasswordConfirmTitle = (name: string): string => `Reset ${name}'s password?`;
export const RESET_PASSWORD_CONFIRM_BODY =
  "Their current password stops working. You'll get a temporary one to share, and they'll choose a new password when they sign in.";
export const RESET_PASSWORD_CONFIRM_VERB = "Reset password";
export const RESET_PASSWORD_DONE_TITLE = "Password reset";
export const RESET_PASSWORD_HINT = "Forgot their password? Email them a reset link, or issue a temporary one.";
export const SEND_RESET_EMAIL_BUTTON = "Email reset link";
export const SENDING_RESET_EMAIL = "Sending…";
export const resetEmailSent = (email: string): string =>
  `Password-reset email sent to ${email}. The link and code in it work for one hour.`;
export const RESET_EMAIL_RATE_LIMITED =
  "Too many emails sent just now. Wait a few minutes, then try again.";
export const RESET_EMAIL_NETWORK = "Couldn't reach the server. Check your connection and try again.";
export const TEMP_PASSWORD_BODY =
  "Share these details privately. The temporary password is shown only once — they'll be asked to set their own when they sign in.";
export const TEMP_PASSWORD_COPY = "Copy login details";
export const TEMP_PASSWORD_COPIED = "Copied";
export const TEMP_PASSWORD_DONE = "Done";

/** The message an admin pastes into WhatsApp/SMS. */
export function loginDetailsMessage(args: {
  appName: string;
  name: string;
  email: string;
  password: string;
}): string {
  return [
    `Hi ${args.name}, here are your ${args.appName} login details:`,
    `Email: ${args.email}`,
    `Temporary password: ${args.password}`,
    "You'll be asked to choose your own password when you sign in.",
  ].join("\n");
}

export { RETRY };
