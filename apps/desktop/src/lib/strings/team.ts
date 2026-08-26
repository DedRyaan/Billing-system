// S7 Team strings - UI-SPEC Copywriting rows owned by plan 03-10.
import { RETRY } from "./global";

export const TEAM_SECTION_TITLE = "Team";
export const TEAM_SEARCH_PLACEHOLDER = "Search name or email";

export const COL_PERSON = "Person";
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

export { RETRY };
