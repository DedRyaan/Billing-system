// Sidebar - 240px warm-tinted rail (S3): BusinessSwitcher slot on top,
// NavList, then UserFooter and the collapse toggle pinned at the bottom
// edge. Collapse animates 240<->56px with a CSS transition <=180ms and
// persists per device via ui-prefs (cosmetic state only, T-3-22).
//
// Presentational by design: contexts are wired by AppShell (__root) so every
// piece stays headless-testable in isolation.
import { useState, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { NavList } from "./NavList";
import { UserFooter } from "./UserFooter";
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "./ui-prefs";

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
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed());

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCollapsed(next);
  };

  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      className="flex shrink-0 flex-col border-r border-hairline bg-sidebar transition-[width] duration-(--duration-base)"
      style={{ width: collapsed ? "var(--width-sidebar-rail)" : "var(--width-sidebar-expanded)" }}
    >
      <Tooltip.Provider delayDuration={0}>
        {switcher !== undefined && <div className="p-sm pb-xs">{switcher}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto py-sm">
          <NavList activePath={activePath} collapsed={collapsed} role={role} onNavigate={onNavigate} />
        </div>
        <div className="px-sd">
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-testid="collapse-toggle"
            onClick={toggle}
            className="flex h-9 w-full items-center justify-center rounded-md text-ink-secondary transition-colors duration-(--duration-fast) hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <PanelLeft size={16} aria-hidden="true" />
          </button>
        </div>
      </Tooltip.Provider>
      <UserFooter fullName={fullName} email={email} role={role} onSignOut={onSignOut} />
    </aside>
  );
}
