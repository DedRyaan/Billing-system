// Shell overlay contract tests (plan 03-06 Task 3): switcher keyboard/
// zero-single/archived contracts, offline banner reactivity, toast host
// rendering + timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react-dom/test-utils";
import type { BusinessRow } from "@billing/api/businesses";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { OfflineBanner } from "./OfflineBanner";
import { ToastHost } from "./ToastHost";
import { resetToasts, showToast } from "./toast-store";

const BID_A = "aaaaaaaa-1111-1111-1111-111111111111";
const BID_B = "bbbbbbbb-2222-2222-2222-222222222222";

const bizA = {
  id: BID_A,
  legal_name: "Alpha Traders",
  trade_name: null,
  gstin: "",
  number_format: "seq",
  prefix: null,
  address: null,
  state: "27",
  phone: null,
  email: null,
  registration_type: "regular",
  logo_path: null,
  archived_at: null,
  created_at: "",
} as BusinessRow;

const archivedB = { ...bizA, id: BID_B, legal_name: "Beta Works", archived_at: "2026-01-01" };

function SwitcherHarness(props: Partial<Parameters<typeof BusinessSwitcher>[0]> = {}) {
  return (
    <BusinessSwitcher
      businesses={[bizA, archivedB]}
      activeBusinessId={BID_A}
      onSwitch={props.onSwitch ?? vi.fn()}
      onManage={props.onManage ?? vi.fn()}
      {...props}
    />
  );
}

describe("BusinessSwitcher", () => {
  it("trigger shows the active business name; popover lists items with Check + archived caption", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(<SwitcherHarness onSwitch={onSwitch} />);

    expect(screen.getByTestId("switcher-trigger").textContent).toContain("Alpha Traders");
    await user.click(screen.getByTestId("switcher-trigger"));

    const listbox = await screen.findByRole("listbox");
    expect(listbox.getAttribute("aria-label")).toBe("Businesses");
    expect(screen.getByText("Archived · read-only")).toBeTruthy();
    const selected = listbox.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toContain("Alpha Traders");
  });

  it("clicking an item switches and closes; Manage businesses link navigates", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const onManage = vi.fn();
    render(<SwitcherHarness onSwitch={onSwitch} onManage={onManage} />);

    await user.click(screen.getByTestId("switcher-trigger"));
    await user.click(await screen.findByRole("option", { name: /Beta Works/ }));
    expect(onSwitch).toHaveBeenCalledWith(BID_B);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="switcher-popover"]')).toBeNull();
    });

    await user.click(screen.getByTestId("switcher-trigger"));
    await user.click(await screen.findByTestId("switcher-manage-link"));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("keyboard: ArrowDown roves focus onto items (Enter then selects natively)", async () => {
    const user = userEvent.setup();
    render(<SwitcherHarness />);
    await user.click(screen.getByTestId("switcher-trigger"));
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("role")).toBe("option");
    });
    await user.keyboard("{ArrowUp}");
    // Focus stays within the option set.
    expect(document.activeElement?.getAttribute("role")).toBe("option");
  });

  it("zero-business admin sees empty state with Add business link", async () => {
    const user = userEvent.setup();
    render(<SwitcherHarness businesses={[]} isAdmin={true} />);
    await user.click(screen.getByTestId("switcher-trigger"));
    expect(await screen.findByTestId("switcher-empty").then((el) => el.textContent)).toContain(
      "No businesses yet",
    );
    expect(screen.getByText("Add business")).toBeTruthy();
  });

  it("zero-business staff variant hides the Add link", async () => {
    const user = userEvent.setup();
    render(<SwitcherHarness businesses={[]} isAdmin={false} />);
    await user.click(screen.getByTestId("switcher-trigger"));
    await screen.findByTestId("switcher-empty");
    expect(screen.queryByText("Add business")).toBeNull();
  });

  it("single-assignment staff sees exactly one checked item", async () => {
    const user = userEvent.setup();
    render(<SwitcherHarness businesses={[bizA]} activeBusinessId={BID_A} isAdmin={false} />);
    await user.click(screen.getByTestId("switcher-trigger"));
    const options = await screen.findAllByRole("option");
    expect(options.length).toBe(1);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("OfflineBanner", () => {
  beforeEach(() => {
    // jsdom reports online:true by default.
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });
  afterEach(() => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  it("renders the exact D-82 copy while offline and disappears on reconnect", async () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });
    const banner = screen.getByTestId("offline-banner");
    expect(banner.textContent).toContain(
      "You're offline — reconnecting… Changes can't save until the connection returns.",
    );

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });
});

describe("ToastHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetToasts();
  });
  afterEach(() => {
    resetToasts();
    vi.useRealTimers();
  });

  function Host() {
    return <ToastHost />;
  }

  it("renders semantic edges/variants inside an aria-live polite region", () => {
    showToast({ variant: "error", message: "boom" });
    showToast({ variant: "success", message: "undone" });
    render(<Host />);
    const host = screen.getByTestId("toast-host");
    expect(host.getAttribute("aria-live")).toBe("polite");
    expect(host.querySelectorAll('[data-toast-variant="error"]').length).toBe(1);
    expect(host.querySelectorAll('[data-toast-variant="success"]').length).toBe(1);
  });

  it("caps the visible stack at three and auto-dismisses with store timing", () => {
    showToast({ message: "a" });
    showToast({ message: "b" });
    showToast({ message: "c" });
    showToast({ message: "d" });
    render(<Host />);
    expect(screen.getAllByRole("status").length).toBe(3);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryAllByRole("status").length).toBe(0);
  });

  it("action button fires once then dismisses its toast; close X dismisses directly", () => {
    const onAction = vi.fn();
    showToast({ variant: "error", message: "Couldn't save customer.", actionLabel: "Retry", onAction });
    render(<Host />);

    const retry = screen.getByRole("button", { name: "Retry" });
    act(() => {
      retry.click();
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();

    let id = "";
    act(() => {
      id = showToast({ variant: "error", message: "second failure" });
    });
    const close = screen.getByTestId(`toast-close-${id}`);
    act(() => {
      close.click();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
