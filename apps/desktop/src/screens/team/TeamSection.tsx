// TeamSection - S7 roster + person sheet with the membership chip grid
// (plan 03-10, AUTH-04/D-78).
//
// ROSTER VISIBILITY IS RLS TRUTH: listRosterForAdmin returns exactly what the
// 0013 policies expose (regular admins see self + managed staff; super_admins
// see all). The UI adds NO extra visibility rule - peer protection is mirrored
// structurally by the returned rows (T-3-37), never re-implemented here.
//
// MEMBERSHIPS: one ToggleChip per accessible business (archived suffixed);
// toggles apply optimistically via setMembership with rollback +
// mutation-failure toast. Honesty microcopy renders beneath the grid - the UI
// NEVER promises instant propagation (D-78). Space/Enter toggle natively
// (chips are buttons carrying role=switch).
//
// LIFECYCLE: staff targets ONLY get deactivate/reactivate controls behind
// verbatim confirms (D-11 scope note lives in strings/team.ts).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileSummary } from "@billing/api/memberships";
import {
  assignmentsOf,
  deactivateStaff,
  listRosterForAdmin,
  reactivateStaff,
  setMembership,
} from "@billing/api/memberships";
import { listBusinesses, type BusinessRow } from "@billing/api/businesses";
import { keysFor } from "@billing/api/query-keys";
import { DataTable, type DataTableColumn } from "../../components/ui/DataTable";
import { Badge } from "../../components/ui/Badge";
import { initialsOf } from "../../shell/UserFooter";
import { Sheet } from "../../components/ui/Sheet";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Button } from "../../components/ui/Button";
import { ToggleChip } from "../../components/ui/ToggleChip";
import { showMutationFailure } from "../../shell/toast-store";
import {
  ARCHIVED_CHIP_SUFFIX,
  COL_BUSINESSES,
  COL_PERSON,
  COL_ROLE,
  COL_STATUS,
  DEACTIVATE_BUTTON,
  DEACTIVATE_CONFIRM_BODY,
  DEACTIVATE_CONFIRM_VERB,
  MEMBERSHIP_GROUP_LABEL,
  MEMBERSHIP_MICROCOPY,
  PERSON_SHEET_TITLE_PREFIX,
  REACTIVATE_BUTTON,
  REACTIVATE_CONFIRM_BODY,
  reactivateConfirmTitle,
  REACTIVATE_CONFIRM_VERB,
  ROLE_BADGE_ADMIN,
  ROLE_BADGE_STAFF,
  STATUS_ACTIVE,
  STATUS_DEACTIVATED,
  TEAM_SEARCH_PLACEHOLDER,
  TEAM_SECTION_TITLE,
  ZERO_ASSIGNMENTS_BODY,
  ZERO_ASSIGNMENTS_TITLE,
  deactivateConfirmTitle,
} from "../../lib/strings/team";

export interface TeamSectionProps {
  /** Injected transport (tests script doubles); production passes auth client. */
  client: SupabaseClient | null;
}

interface EnrichedProfile extends ProfileSummary {
  assignmentNames: string[];
}

interface RosterVM {
  id: string;
  full_name: string;
  email: string;
  role_label: string;
  assignments_label: string;
  status_label: string;
}

function roleBadge(role: string): string {
  return role === "staff" ? ROLE_BADGE_STAFF : ROLE_BADGE_ADMIN;
}

function summarizeAssignments(names: string[]): string {
  if (names.length === 0) return "—";
  const head = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${head} +${names.length - 2}` : head;
}

export function TeamSection({ client }: TeamSectionProps) {
  const [openPerson, setOpenPerson] = useState<EnrichedProfile | null>(null);

  const roster = useQuery({
    queryKey: ["memberships", "roster"] as const,
    queryFn: async () => {
      if (!client) throw new Error("no client");
      const res = await listRosterForAdmin(client);
      if (!res.ok) throw new Error(res.error.message);
      const people = res.data;
      // Small rosters: inline assignment summaries for the Businesses column
      // without per-row render waterfalls.
      return Promise.all(
        people.map(async (p) => {
          const a = await assignmentsOf(client, p.id);
          return {
            ...p,
            assignmentNames: a.ok
              ? a.data
                  .map((row) => row.business?.legal_name ?? "")
                  .filter((n) => n.length > 0)
                  .sort((x, y) => x.localeCompare(y))
              : [],
          } satisfies EnrichedProfile;
        }),
      );
    },
    enabled: client !== null,
  });

  const rows = useMemo<EnrichedProfile[]>(() => roster.data ?? [], [roster.data]);

  const vms = useMemo<RosterVM[]>(
    () =>
      rows.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        email: r.email,
        role_label: roleBadge(r.role),
        assignments_label: summarizeAssignments(r.assignmentNames),
        status_label: r.is_active ? STATUS_ACTIVE : STATUS_DEACTIVATED,
      })),
    [rows],
  );

  const columns: ReadonlyArray<DataTableColumn<RosterVM>> = [
    { key: "full_name", label: COL_PERSON, sortable: true, truncate: true },
    { key: "email", label: COL_PERSON },
    { key: "role_label", label: COL_ROLE },
    { key: "assignments_label", label: COL_BUSINESSES },
    { key: "status_label", label: COL_STATUS },
  ];

  return (
    <section aria-label={TEAM_SECTION_TITLE}>
      <DataTable<RosterVM>
        columns={columns}
        rows={vms}
        getRowId={(r) => r.id}
        searchableKeys={["full_name", "email"]}
        rowKeyLabel="members"
        isLoading={roster.isLoading}
        isError={roster.isError}
        onRetry={() => void roster.refetch()}
        searchPlaceholder={TEAM_SEARCH_PLACEHOLDER}
        getRowClassName={(vm) => (vm.status_label === STATUS_DEACTIVATED ? "opacity-50" : "")}
        onRowActivate={(vm) => {
          const person = rows.find((r) => r.id === vm.id);
          if (person !== undefined) setOpenPerson(person);
        }}
      />
      {openPerson !== null && client !== null && (
        <PersonSheet open onClose={() => setOpenPerson(null)} client={client} person={openPerson} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// PersonSheet
// ---------------------------------------------------------------------------

export interface PersonSheetProps {
  open: boolean;
  onClose: () => void;
  client: SupabaseClient | null;
  person: ProfileSummary & { assignmentNames?: string[] };
}

export function PersonSheet({ open, onClose, client, person }: PersonSheetProps) {
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
  const [confirm, setConfirm] = useState<"deactivate" | "reactivate" | null>(null);
  const [lifecycleState, setLifecycleState] = useState(person.is_active);

  // Accessible-business universe for the chip grid (RLS listing).
  const businesses = useQuery({
    queryKey: keysFor.businesses(),
    enabled: open && client !== null,
    queryFn: async () => {
      const res = await listBusinesses(client!);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  // Assignments for this person load when the sheet opens.
  useEffect(() => {
    if (!open || !client) return;
    let cancelled = false;
    void assignmentsOf(client, person.id).then((res) => {
      if (cancelled) return;
      setAssignedIds(new Set(res.ok ? res.data.map((r) => r.business_id) : []));
      setAssignmentsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [client, open, person.id]);

  const toggle = async (businessId: string) => {
    if (!client) return;
    const nowOn = !assignedIds.has(businessId);
    const previous = assignedIds;
    const next = new Set(assignedIds);
    if (nowOn) next.add(businessId);
    else next.delete(businessId);
    setAssignedIds(next); // optimistic flip
    const res = await setMembership(client, {
      userId: person.id,
      businessId,
      assigned: nowOn,
    });
    if (!res.ok) {
      setAssignedIds(previous); // rollback on denial
      showMutationFailure("member", () => undefined);
    }
  };

  const runLifecycle = async (verb: "deactivate" | "reactivate") => {
    if (!client) return;
    const res =
      verb === "deactivate"
        ? await deactivateStaff(client, person.id)
        : await reactivateStaff(client, person.id);
    if (res.ok) setLifecycleState(verb === "deactivate" ? false : true);
    else showMutationFailure("member", () => undefined);
  };

  // Peer protection mirror: lifecycle controls exist ONLY for staff targets.
  const isStaffTarget = person.role === "staff";

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={`${PERSON_SHEET_TITLE_PREFIX}: ${person.full_name}`}
        dirty={false}
      >
        <div className="flex flex-col gap-lg">
          {/* Identity block - read-only this phase. */}
          <div className="flex items-center gap-sd">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-body font-semibold text-accent-hover"
            >
              {initialsOf(person.full_name, person.email)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-heading text-ink">{person.full_name}</span>
              <span className="block text-caption text-ink-secondary">{person.email}</span>
            </span>
            <span className="ml-auto shrink-0">
              <Badge tone={person.role === "staff" ? "accent" : "neutral"}>
                {roleBadge(person.role)}
              </Badge>
            </span>
          </div>

          {/* Membership chip grid (labelled group). */}
          <div role="group" aria-label={MEMBERSHIP_GROUP_LABEL} data-testid="membership-grid">
            {assignmentsLoaded && assignedIds.size === 0 && (
              <div className="mb-sm" data-testid="zero-assignments">
                <p className="text-body font-semibold text-ink">{ZERO_ASSIGNMENTS_TITLE}</p>
                <p className="text-caption text-ink-secondary">{ZERO_ASSIGNMENTS_BODY}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-xs">
              {(businesses.data ?? []).map((b: BusinessRow) => (
                <ToggleChip
                  key={b.id}
                  label={`${b.legal_name}${b.archived_at !== null ? ` ${ARCHIVED_CHIP_SUFFIX}` : ""}`}
                  on={assignedIds.has(b.id)}
                  onToggle={() => void toggle(b.id)}
                />
              ))}
            </div>
            <p className="mt-sm text-caption text-ink-secondary">{MEMBERSHIP_MICROCOPY}</p>
          </div>

          {/* Lifecycle actions - STAFF targets only (D-11 scope mirror). */}
          {isStaffTarget && (
            <div className="flex items-center justify-between border-t border-hairline pt-md">
              <span className="flex items-center gap-xs text-caption text-ink-secondary">
                Status:{" "}
                <Badge tone={lifecycleState ? "success" : "danger"}>
                  {lifecycleState ? STATUS_ACTIVE : STATUS_DEACTIVATED}
                </Badge>
              </span>
              {lifecycleState ? (
                <Button type="button" variant="danger-text" onClick={() => setConfirm("deactivate")}>
                  {DEACTIVATE_BUTTON}
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={() => setConfirm("reactivate")}>
                  {REACTIVATE_BUTTON}
                </Button>
              )}
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirm === "deactivate"}
        onOpenChange={(o) => setConfirm(o ? "deactivate" : null)}
        title={deactivateConfirmTitle(person.full_name)}
        body={DEACTIVATE_CONFIRM_BODY}
        confirmLabel={DEACTIVATE_CONFIRM_VERB}
        tone="danger"
        onConfirm={() => void runLifecycle("deactivate")}
      />
      <ConfirmDialog
        open={confirm === "reactivate"}
        onOpenChange={(o) => setConfirm(o ? "reactivate" : null)}
        title={reactivateConfirmTitle(person.full_name)}
        body={REACTIVATE_CONFIRM_BODY}
        confirmLabel={REACTIVATE_CONFIRM_VERB}
        onConfirm={() => void runLifecycle("reactivate")}
      />
    </>
  );
}
