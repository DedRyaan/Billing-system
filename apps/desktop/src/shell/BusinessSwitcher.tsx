// BusinessSwitcher - sidebar-top trigger + 320px popover (S9/D-67).
// Lists the RLS-visible businesses (the listing IS the truth: staff see only
// assignments, admins all incl. archived-flagged). Keyboard-complete:
// ArrowUp/Down rove focus, Enter selects (native button), Esc closes (Radix).
// Archived items stay SELECTABLE with a read-only caption - D-35/D-36.
import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown } from "lucide-react";
import type { BusinessRow } from "@billing/api/businesses";
import {
  CTA_ADD_BUSINESS,
  SWITCHER_ARCHIVED_SUFFIX,
  SWITCHER_EMPTY_TITLE,
  SWITCHER_MANAGE_LINK,
  SWITCHER_SELECT_PLACEHOLDER,
} from "../lib/strings/shell";

export interface BusinessSwitcherProps {
  businesses: readonly BusinessRow[];
  activeBusinessId: string | null;
  isLoading?: boolean;
  /** Zero-business empty state carries the Add link for admins. */
  isAdmin?: boolean;
  onSwitch: (businessId: string) => void;
  onManage: () => void;
}

export function BusinessSwitcher({
  businesses,
  activeBusinessId,
  isLoading = false,
  isAdmin = false,
  onSwitch,
  onManage,
}: BusinessSwitcherProps) {
  const active = businesses.find((b) => b.id === activeBusinessId) ?? null;
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);

  const pick = (id: string) => {
    setOpen(false);
    onSwitch(id);
  };

  const manage = () => {
    setOpen(false);
    onManage();
  };

  const onKeyDownRoving = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const currentIdx = items.findIndex((el) => el === document.activeElement);
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const nextIdx =
      currentIdx === -1 ? 0 : (currentIdx + dir + items.length) % items.length;
    items[nextIdx]?.focus();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="switcher-trigger"
          className="flex h-11 w-full items-center gap-sm rounded-md px-sd text-left transition-colors duration-(--duration-fast) hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <img
            src="/branding/tile-mark-light.svg"
            alt=""
            aria-hidden="true"
            width={20}
            height={20}
            className="shrink-0 rounded-sm"
          />
          <span className="min-w-0 flex-1 truncate text-body text-ink">
            {active?.legal_name ?? SWITCHER_SELECT_PLACEHOLDER}
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          onKeyDown={onKeyDownRoving}
          data-testid="switcher-popover"
          className="w-(--width-switcher-popover) rounded-xl border border-hairline bg-surface p-sm shadow-popover"
        >
          <p className="px-sm pb-xs pt-sm uppercase tracking-[0.04em] text-caption text-ink-secondary">
            Businesses
          </p>

          {isLoading ? (
            <p className="px-sm py-sm text-caption text-ink-muted" data-testid="switcher-loading">
              Loading…
            </p>
          ) : businesses.length === 0 ? (
            <div className="flex flex-col gap-xs px-sm py-sm" data-testid="switcher-empty">
              <p className="text-body text-ink">{SWITCHER_EMPTY_TITLE}</p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={manage}
                  className="text-caption text-accent-hover underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {CTA_ADD_BUSINESS}
                </button>
              )}
            </div>
          ) : (
            <div role="listbox" aria-label="Businesses" className="max-h-72 overflow-y-auto">
              {businesses.map((b, idx) => {
                const isActive = b.id === activeBusinessId;
                const archived = b.archived_at != null;
                return (
                  <button
                    key={b.id}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => pick(b.id)}
                    className={`flex h-9 w-full items-center gap-sm rounded-md px-sm text-left transition-colors duration-(--duration-fast) hover:bg-paper focus-visible:bg-accent-subtle focus-visible:outline-none ${
                      isActive ? "bg-accent-subtle" : ""
                    }`}
                  >
                    <span aria-hidden="true" className="w-4 shrink-0">
                      {isActive && <Check size={16} className="text-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{b.legal_name}</span>
                      {archived && (
                        <span className="block text-caption text-ink-secondary">
                          {SWITCHER_ARCHIVED_SUFFIX}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-sm border-t border-hairline pt-sm">
            <button
              type="button"
              data-testid="switcher-manage-link"
              onClick={manage}
              className="w-full rounded-md px-sm py-xs text-left text-caption text-accent-hover underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {SWITCHER_MANAGE_LINK}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
