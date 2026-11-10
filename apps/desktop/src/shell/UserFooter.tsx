// UserFooter - the permanent AUTH-05/D-71 logout home: 28px initials avatar
// (accent-subtle bg), truncated name, role caption, LogOut icon-button.
// Signs out THIS device only (D-71).
import { LogOut } from "lucide-react";
import { roleCaption, SIGN_OUT_ARIA_LABEL } from "../lib/strings/shell";

export function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || "";
  if (source.length === 0) return "?";
  const parts = source.split(/[\s.@_]+/).filter((p) => p.length > 0);
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts.length > 1 ? (parts[1]?.charAt(0) ?? "") : "";
  return `${first}${second}`.toUpperCase() || "?";
}

export interface UserFooterProps {
  fullName: string | null;
  email: string | null;
  /** Server-controlled profile role; rendered via roleCaption(). */
  role: string | null;
  onSignOut: () => void;
  /** Icon rail: avatar only (name, role and sign-out show when expanded). */
  collapsed?: boolean;
}

export function UserFooter({ fullName, email, role, onSignOut, collapsed = false }: UserFooterProps) {
  const label = fullName ?? email ?? "Account";
  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-hairline py-sd" data-testid="user-footer">
        <span
          role="img"
          aria-label={`${label}, ${roleCaption(role)}`}
          title={label}
          data-testid="footer-initials"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-caption font-semibold text-accent-hover"
        >
          {initialsOf(fullName, email)}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-sm border-t border-hairline px-sd py-sd" data-testid="user-footer">
      <span
        aria-hidden="true"
        data-testid="footer-initials"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-caption font-semibold text-accent-hover"
      >
        {initialsOf(fullName, email)}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-body text-ink">{label}</span>
        <span className="block text-caption text-ink-secondary">{roleCaption(role)}</span>
      </span>
      <button
        type="button"
        aria-label={SIGN_OUT_ARIA_LABEL}
        data-testid="logout-button"
        onClick={onSignOut}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors duration-(--duration-fast) hover:bg-sidebar-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <LogOut size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
