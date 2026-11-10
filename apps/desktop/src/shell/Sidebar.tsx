// Sidebar - warm-tinted rail (S3): BusinessSwitcher + pin button on top,
// NavList, UserFooter at the bottom edge.
//
// Pinned (default): the full 240px sidebar sits in the layout.
// Unpinned: only the 56px icon rail takes layout space; hovering it (or
// tabbing into it) slides the full sidebar out OVER the content, and moving
// away tucks it back. The pin state persists per device via ui-prefs
// (cosmetic state only, T-3-22; stored under the legacy "collapsed" key).
//
// Presentational by design: contexts are wired by AppShell (__root) so every
// piece stays headless-testable in isolation.
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Pin, PinOff } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { NavList } from "./NavList";
import { UserFooter } from "./UserFooter";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./ui-prefs";

/** Hover intent delay before an unpinned rail slides open. */
const PEEK_DELAY_MS = 150;

export interface SidebarProps {
  activePath: string;
  role: string | null;
  fullName: string | null;
  email: string | null;
  onSignOut: () => void;
  onNavigate: (to: string) => void;
  /** BusinessSwitcher slot (Task 3 component drops in). */
  switcher?: ReactNode;
}

export function Sidebar({ activePath, role, fullName, email, onSignOut, onNavigate, switcher }: SidebarProps) {
  const [pinned, setPinned] = useState(() => !readSidebarCollapsed());
  const [peeking, setPeeking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const expanded = pinned || peeking;
  const overlay = !pinned && peeking;

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    writeSidebarCollapsed(!next);
    // Unpinning while the pointer is over the sidebar keeps it open until
    // the pointer leaves - no jarring snap shut under the cursor.
    setPeeking(!next);
  };

  const openSoon = () => {
    if (pinned) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeeking(true), PEEK_DELAY_MS);
  };

  const close = () => {
    clearTimeout(timer.current);
    setPeeking(false);
  };

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  };

  // Navigating from the slide-out finishes the job: tuck it away.
  const navigate = (to: string) => {
    if (!pinned) close();
    onNavigate(to);
  };

  return (
    <div
      data-testid="sidebar-slot"
      className="relative shrink-0 transition-[width] duration-(--duration-base)"
      style={{ width: pinned ? "var(--width-sidebar-expanded)" : "var(--width-sidebar-rail)" }}
    >
      <aside
        data-testid="sidebar"
        data-collapsed={expanded ? "false" : "true"}
        data-pinned={pinned ? "true" : "false"}
        onMouseEnter={openSoon}
        onMouseLeave={close}
        onFocus={() => {
          if (!pinned) setPeeking(true);
        }}
        onBlur={onBlur}
        className={`absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-hairline bg-sidebar transition-[width,box-shadow] duration-(--duration-base) ${
          overlay ? "shadow-popover" : ""
        }`}
        style={{ width: expanded ? "var(--width-sidebar-expanded)" : "var(--width-sidebar-rail)" }}
      >
        <Tooltip.Provider delayDuration={0}>
          <div className="flex items-center gap-xs p-sm pb-xs">
            {switcher !== undefined && <div className="min-w-0 flex-1">{switcher}</div>}
            {expanded && (
              <button
                type="button"
                aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
                aria-pressed={pinned}
                title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
                data-testid="pin-toggle"
                onClick={togglePin}
                className={`ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-(--duration-fast) hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  pinned ? "text-ink-secondary hover:text-ink" : "text-accent"
                }`}
              >
                {pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-sm">
            <NavList activePath={activePath} collapsed={!expanded} role={role} onNavigate={navigate} />
          </div>
        </Tooltip.Provider>
        <UserFooter
          fullName={fullName}
          email={email}
          role={role}
          onSignOut={onSignOut}
          collapsed={!expanded}
        />
      </aside>
    </div>
  );
}
