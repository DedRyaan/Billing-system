// Display + feedback primitives behaviors - RED.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Users } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge";
import { ToggleChip } from "./ToggleChip";
import { CapsLockIndicator } from "./CapsLockIndicator";
import { TableRowsSkeleton } from "./Skeletons";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { ConfirmDialog } from "./ConfirmDialog";

describe("Badge", () => {
  it("pill h20 caption with semantic pair tones; optional glyph; never a button", () => {
    render(<Badge tone="success" glyph={<i data-testid="g" />}>Verified</Badge>);
    const badge = screen.getByText("Verified").closest("span")!;
    expect(badge.className).toContain("rounded-(--radius-pill)");
    expect(badge.className).toContain("bg-success-subtle");
    expect(screen.getByTestId("g")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["neutral", "bg-paper"],
    ["accent", "bg-accent-subtle"],
    ["warning", "bg-warning-subtle"],
    ["danger", "bg-danger-subtle"],
  ] as const)("tone %s uses its subtle bg token", (tone, cls) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    expect(screen.getByText(tone).className).toContain(cls);
  });
});

describe("ToggleChip", () => {
  it("off state renders Plus glyph + hairline border; Space toggles", async () => {
    let on = false;
    const { rerender } = render(
      <ToggleChip
        label="Acme Traders"
        on={on}
        onToggle={() => {
          on = true;
          rerender(<ToggleChip label="Acme Traders" on onToggle={() => undefined} />);
        }}
      />,
    );
    const chip = screen.getByRole("switch");
    expect(chip.getAttribute("aria-checked")).toBe("false");

    await userEvent.type(chip, "{Space}");
    const after = screen.getByRole("switch");
    expect(after.getAttribute("aria-checked")).toBe("true");
    expect(after.className).toContain("bg-accent-subtle");
  });
});

describe("CapsLockIndicator", () => {
  it("renders the exact warning copy only when active", () => {
    const { rerender } = render(<CapsLockIndicator active={false} />);
    expect(screen.queryByText("Caps Lock is on")).toBeNull();
    rerender(<CapsLockIndicator active />);
    expect(screen.getByText("Caps Lock is on")).toBeInTheDocument();
  });
});

describe("TableRowsSkeleton", () => {
  it("delays visibility 150ms then marks container aria-busy with aria-hidden rows", async () => {
    vi.useFakeTimers();
    const { container } = render(<TableRowsSkeleton rows={5} />);
    expect(container.querySelector("[aria-busy='true']")).toBeNull();

    await act(async () => vi.advanceTimersByTime(160));
    const busy = container.querySelector("[aria-busy='true']");
    expect(busy).not.toBeNull();
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThanOrEqual(5);
    vi.useRealTimers();
  });
});

describe("EmptyState / ErrorState", () => {
  it("EmptyState: icon circle -> Heading -> body copy -> optional CTA", async () => {
    const onCta = vi.fn();
    render(
      <EmptyState
        icon={<Users />}
        title="No customers yet"
        copy="Add your first customer — bills will pick their details straight from here."
        cta={{ label: "Add customer", onClick: onCta }}
      />,
    );
    expect(screen.getByRole("heading", { name: "No customers yet" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(onCta).toHaveBeenCalledOnce();
  });

  it("ErrorState announces via role=alert and Retry invokes callback", async () => {
    const retry = vi.fn();
    render(<ErrorState entity="customers" onRetry={retry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load customers.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("ConfirmDialog", () => {
  function Harness(props: Partial<Parameters<typeof ConfirmDialog>[0]>): React.ReactElement {
    return (
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Archive Acme Traders?"
        body="Archived businesses leave daily views but keep every record for GST."
        confirmLabel="Archive business"
        tone="danger"
        onConfirm={() => undefined}
        {...props}
      />
    );
  }

  it("title as question; confirm button repeats the verb; initial focus lands on CANCEL", () => {
    render(<Harness />);
    expect(screen.getByRole("dialog", { name: "Archive Acme Traders?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });

  it("confirm invokes callback; Esc cancels without confirming", async () => {
    const confirmed = vi.fn();
    render(<Harness onConfirm={confirmed} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive business" }));
    expect(confirmed).toHaveBeenCalledOnce();

    const cancelled = vi.fn();
    const onOpenChange = vi.fn();
    render(<Harness onConfirm={cancelled} onOpenChange={onOpenChange} />);
    // Radix closes on Esc and routes through onOpenChange(false).
    await userEvent.keyboard("{Escape}");
    await act(async () => {});
    expect(cancelled).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
