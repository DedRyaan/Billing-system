// NavList - the six D-66 nav slots (locked forever; no Team entry - A6).
// Item contract: h36 radius-md pill, hover sidebar-hover tint; active =
// accent-subtle bg + accent icon + 600 label. Collapsed rail centers icons
// with Radix tooltips right-placed. Admin-only visibility (Businesses) is
// derived from the server-truth profile role each render (T-3-22) - never
// from any persisted pref.
import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Building2,
  FileText,
  IndianRupee,
  LayoutDashboard,
  Package,
  Settings,
  Users,
} from "lucide-react";
import {
  NAV_BILLS,
  NAV_BUSINESSES,
  NAV_CATALOG,
  NAV_CUSTOMERS,
  NAV_DASHBOARD,
  NAV_OUTSTANDINGS,
  NAV_SETTINGS,
} from "../lib/strings/shell";

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: ReactNode;
}

/** D-66 order; Businesses carries the admin-only visibility predicate. */
export const NAV_ITEMS: readonly (NavItem & { adminOnly?: boolean })[] = [
  { key: "dashboard", label: NAV_DASHBOARD, to: "/dashboard", icon: <LayoutDashboard size={20} aria-hidden="true" /> },
  { key: "bills", label: NAV_BILLS, to: "/bills", icon: <FileText size={20} aria-hidden="true" /> },
  { key: "outstandings", label: NAV_OUTSTANDINGS, to: "/outstandings", icon: <IndianRupee size={20} aria-hidden="true" /> },
  { key: "customers", label: NAV_CUSTOMERS, to: "/customers", icon: <Users size={20} aria-hidden="true" /> },
  { key: "catalog", label: NAV_CATALOG, to: "/catalog", icon: <Package size={20} aria-hidden="true" /> },
  { key: "businesses", label: NAV_BUSINESSES, to: "/businesses", icon: <Building2 size={20} aria-hidden="true" />, adminOnly: true },
  { key: "settings", label: NAV_SETTINGS, to: "/settings", icon: <Settings size={20} aria-hidden="true" /> },
];

/** Active section = longest prefix match so future nested paths stay lit. */
function isActiveSection(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export interface NavListProps {
  activePath: string;
  collapsed: boolean;
  /** Server-controlled profile role (null hides admin-only entries). */
  role: string | null;
  onNavigate: (to: string) => void;
}

const isAdminRole = (role: string | null): boolean => role === "admin" || role === "super_admin";

export function NavList({ activePath, collapsed, role, onNavigate }: NavListProps) {
  const adminVisible = isAdminRole(role);
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || adminVisible);

  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-xs px-sm">
        {items.map((item) => {
          const active = isActiveSection(activePath, item.to);
          const link = (
            <button
              type="button"
              data-nav-item={item.to}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.to)}
              className={`flex h-9 w-full items-center rounded-md transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                collapsed ? "justify-center px-0" : "gap-sd px-sd"
              } ${
                active
                  ? "bg-accent-subtle text-accent [&_svg]:text-accent"
                  : "text-ink-secondary hover:bg-sidebar-hover hover:text-ink"
              }`}
            >
              <span aria-hidden="true" className="flex shrink-0 items-center justify-center">
                {item.icon}
              </span>
              {!collapsed && (
                <span className={`truncate text-body ${active ? "font-semibold text-ink" : ""}`}>
                  {item.label}
                </span>
              )}
            </button>
          );

          return (
            <li key={item.key}>
              {collapsed ? (
                <Tooltip.Provider delayDuration={0}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="right"
                        sideOffset={8}
                        className="rounded-md bg-ink px-sm py-xs text-caption text-paper shadow-popover"
                      >
                        {item.label}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              ) : (
                link
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
