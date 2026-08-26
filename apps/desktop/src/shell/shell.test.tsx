// Shell chrome contract tests (plan 03-06 Task 2): nav gating from
// server-truth role, persistent collapse, footer logout, header anatomy,
// placeholder ghost with zero interactivity, exact spec copy.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { HeaderRow } from "./HeaderRow";
import { PlaceholderScreen } from "./PlaceholderScreen";
import { setPrefsBackend, type PrefsBackend } from "./ui-prefs";
import {
  NAV_BUSINESSES,
  PLACEHOLDER_BILLS_BODY,
  PLACEHOLDER_DASHBOARD_BODY,
} from "../lib/strings/shell";

function memoryPrefs(): PrefsBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

interface RenderSidebarOpts {
  role?: string | null;
  collapsedSeed?: string;
}

function renderSidebar(opts: RenderSidebarProps | RenderSidebarOpts = {}) {
  const o = opts as RenderSidebarOpts;
  const prefs = memoryPrefs();
  if (o.collapsedSeed !== undefined) prefs.store.set("ui.sidebar.collapsed", o.collapsedSeed);
  setPrefsBackend(prefs);
  const onNavigate = vi.fn();
  const onSignOut = vi.fn();
  const utils = render(
    <div style={{ display: "flex" }}>
      <Sidebar
        activePath="/customers"
        role={o.role ?? "admin"}
        fullName="Asha Patil"
        email="asha@example.com"
        onSignOut={onSignOut}
        onNavigate={onNavigate}
      />
    </div>,
  );
  return { ...utils, prefs, onNavigate, onSignOut };
}

// Alias to keep signature honest for future prop additions.
type RenderSidebarProps = Record<string, unknown>;

beforeEach(() => setPrefsBackend(null));
afterEach(() => setPrefsBackend(null));

describe("NavList via Sidebar", () => {
  it("renders all six D-66 entries for admins", () => {
    const { getByText } = renderSidebar({ role: "admin" });
    expect(getByText("Dashboard")).toBeTruthy();
    expect(getByText("Bills")).toBeTruthy();
    expect(getByText("Customers")).toBeTruthy();
    expect(getByText("Catalog")).toBeTruthy();
    expect(getByText(NAV_BUSINESSES)).toBeTruthy();
    expect(getByText("Settings")).toBeTruthy();
  });

  it("hides the admin-only Businesses entry from staff (role-sourced, not pref-sourced)", () => {
    const { queryByText } = renderSidebar({ role: "staff" });
    expect(queryByText(NAV_BUSINESSES)).toBeNull();
    // The other five stay.
    expect(queryByText("Customers")).not.toBeNull();
  });

  it("marks the active section with aria-current", () => {
    const { getByLabelText } = renderSidebar({ role: "staff" });
    const active = document.querySelector('[data-nav-item="/customers"]');
    expect(active?.getAttribute("aria-current")).toBe("page");
    void getByLabelText;
  });

  it("navigates on item click", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderSidebar({ role: "staff" });
    await user.click(screen.getByText("Settings"));
    expect(onNavigate).toHaveBeenCalledWith("/settings");
  });
});

describe("Sidebar collapse", () => {
  it("toggles rail width and persists through ui-prefs", async () => {
    const user = userEvent.setup();
    const { prefs, getByTestId } = renderSidebar({ role: "staff" });
    expect(getByTestId("sidebar").getAttribute("data-collapsed")).toBe("false");
    await user.click(getByTestId("collapse-toggle"));
    expect(getByTestId("sidebar").getAttribute("data-collapsed")).toBe("true");
    expect(prefs.store.get("ui.sidebar.collapsed")).toBe("1");
  });

  it("restores persisted collapsed state on mount", () => {
    const { getByTestId } = renderSidebar({ role: "staff", collapsedSeed: "1" });
    expect(getByTestId("sidebar").getAttribute("data-collapsed")).toBe("true");
  });

  it("collapsed mode hides labels and exposes aria-labels for tooltips", () => {
    const { getByTestId } = renderSidebar({ role: "staff", collapsedSeed: "1" });
    expect(getByTestId("sidebar").textContent).not.toContain("Dashboard");
    const item = document.querySelector<HTMLElement>('[data-nav-item="/dashboard"]');
    expect(item?.getAttribute("aria-label")).toBe("Dashboard");
  });
});

describe("UserFooter", () => {
  it("renders initials avatar, truncated name, role caption; logout invokes signOut once", async () => {
    const user = userEvent.setup();
    const { getByTestId, onSignOut } = renderSidebar({ role: "super_admin" });
    expect(getByTestId("footer-initials").textContent).toBe("AP");
    expect(getByTestId("user-footer").textContent).toContain("Asha Patil");
    expect(getByTestId("user-footer").textContent).toContain("Admin");
    await user.click(getByTestId("logout-button"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("staff role renders the Staff caption", () => {
    const { getByTestId } = renderSidebar({ role: "staff" });
    expect(getByTestId("user-footer").textContent).toContain("Staff");
  });
});

describe("HeaderRow", () => {
  it("renders Heading title left and actions slot right with hairline bottom", () => {
    render(
      <HeaderRow
        title="Customers"
        actions={<button type="button">Add customer</button>}
      />,
    );
    const row = screen.getByTestId("header-row");
    expect(row.textContent).toContain("Customers");
    expect(row.tagName).toBe("HEADER");
    expect(row.querySelector("h1")?.className).toContain("text-heading");
    expect(row.querySelector("button")?.textContent).toBe("Add customer");
  });
});

describe("PlaceholderScreen", () => {
  it("ghost composition matches spec copy with ZERO interactive elements", () => {
    render(
      <PlaceholderScreen
        icon={<FileText size={40} aria-hidden="true" />}
        title="Bills"
        body={PLACEHOLDER_BILLS_BODY}
      />,
    );
    const section = screen.getByTestId("placeholder-screen");
    expect(section.querySelectorAll("button, a, input, select, textarea").length).toBe(0);
    expect(section.textContent).toContain(PLACEHOLDER_BILLS_BODY);
  });

  it("dashboard copy is the exact Copywriting-table row (em dash)", () => {
    render(
      <PlaceholderScreen icon={null} title="Dashboard" body={PLACEHOLDER_DASHBOARD_BODY} />,
    );
    expect(screen.getByTestId("placeholder-screen").textContent).toContain(
      "Your dashboard arrives in Phase 8 — outstandings and revenue at a glance.",
    );
  });
});
