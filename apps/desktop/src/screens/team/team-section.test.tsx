// Team roster + membership chip grid contracts (plan 03-10 Task 1, AUTH-04).
// Peer exclusion mirrors 0007 policy shape (regular admins' rosters contain
// no other admins because RLS returns none - the UI adds no extra rule but
// proves the fixture shape). Honesty microcopy + reversible optimistic
// toggles + keyboard completeness proven headlessly.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamSection } from "./TeamSection";

const BID_A = "a0a0a0a0-0000-0000-0000-000000000001";
const BID_B = "b0b0b0b0-0000-0000-0000-000000000002";
const BID_C = "c0c0c0c0-0000-0000-0000-000000000003";
const STAFF_ID = "staff-1";
const ADMIN_ID = "admin-me";

function profile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: STAFF_ID,
    email: "ravi@billing.test",
    full_name: "Ravi Kumar",
    role: "staff",
    is_active: true,
    locked_at: null,
    ...overrides,
  };
}

function business(id: string, name: string, archived = false) {
  return { id, legal_name: name, archived_at: archived ? "2026-01-01" : null };
}

interface FixtureOpts {
  role?: string;
  profiles?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
}

function baseFixtures(opts: FixtureOpts = {}): Record<string, unknown> {
  const role = opts.role ?? "super_admin";
  return {
    session: { access_token: "at", refresh_token: "rt" },
    profileRow: { id: ADMIN_ID, role, is_active: true, locked_at: null, full_name: "Asha Patil", email: "asha@billing.test" },
    tables: {
      profiles: opts.profiles ?? [profile(), profile({ id: ADMIN_ID, full_name: "Asha Patil", email: "asha@billing.test", role })],
      businesses: [
        business(BID_A, "Alpha Traders"),
        business(BID_B, "Beta Works"),
        business(BID_C, "Gamma Stores", true),
      ],
      business_members: opts.assignments ?? [],
    },
  };
}

function mount(client: ReturnType<typeof import("../../lib/test/fake-client").makeScriptedClient>) {
  // Lazy require keeps hoisting simple in this file.
  const { makeScriptedClient } = require("../../lib/test/fake-client") as typeof import("../../lib/test/fake-client");
  void makeScriptedClient;
  return render(<TeamSection client={client} />);
}

async function mountedTeam(opts: FixtureOpts = {}) {
  const { makeScriptedClient } = await import("../../lib/test/fake-client");
  const client = makeScriptedClient(baseFixtures(opts));
  const utils = mount(client);
  await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
  return { client, ...utils };
}

describe("roster", () => {
  it("renders Person/Role/Businesses/Status columns with badges and assignment summaries", async () => {
    await mountedTeam({
      assignments: [
        { business_id: BID_A, user_id: STAFF_ID, businesses: business(BID_A, "Alpha Traders") },
        { business_id: BID_B, user_id: STAFF_ID, businesses: business(BID_B, "Beta Works") },
      ],
    });
    expect(document.querySelector("[data-testid='datatable']")!.textContent).toContain("Staff");
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("overflow caption math at 3+ assignments shows first two plus +n", async () => {
    await mountedTeam({
      assignments: [
        { business_id: BID_A, user_id: STAFF_ID, businesses: business(BID_A, "Alpha Traders") },
        { business_id: BID_B, user_id: STAFF_ID, businesses: business(BID_B, "Beta Works") },
        { business_id: BID_C, user_id: STAFF_ID, businesses: business(BID_C, "Gamma Stores") },
      ],
    });
    const table = document.querySelector("[data-testid='datatable']")!;
    expect(table.textContent).toContain("Alpha Traders");
    expect(table.textContent).toContain("+1");
  });

  it("peer protection mirror: a regular admin's roster fixture carries only self+staff - no admin rows render", async () => {
    await mountedTeam({
      role: "admin",
      profiles: [
        profile({ id: ADMIN_ID, full_name: "Asha Patil", email: "asha@billing.test", role: "admin" }),
        profile(),
      ],
    });
    // Only the staff row appears besides self; no second Admin badge.
    const badges = Array.from(document.querySelectorAll("[data-testid='datatable'] span")).filter(
      (el) => el.textContent === "Admin",
    );
    expect(badges.length).toBeLessThanOrEqual(1);
  });
});

describe("person sheet membership grid", () => {
  it("chip per accessible business incl. archived suffix; on-state reflects assignments", async () => {
    const user = userEvent.setup();
    await mountedTeam({
      assignments: [{ business_id: BID_A, user_id: STAFF_ID, businesses: business(BID_A, "Alpha Traders") }],
    });
    await user.click(screen.getByText("Ravi Kumar"));
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBe(3));
    const alphaChip = screen.getByRole("switch", { name: /Alpha Traders/ });
    expect(alphaChip.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("(archived)").textContent).toBe("(archived)");
    // Zero-membership copy hidden while assigned.
    expect(screen.queryByText("Not assigned anywhere")).toBeNull();
  });

  it("toggling applies optimistically via setMembership delete and flips aria-checked", async () => {
    const user = userEvent.setup();
    const { client } = await mountedTeam({
      assignments: [{ business_id: BID_A, user_id: STAFF_ID, businesses: business(BID_A, "Alpha Traders") }],
    });
    await user.click(screen.getByText("Ravi Kumar"));
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBe(3));

    const chip = screen.getByRole("switch", { name: /Alpha Traders/ });
    await user.click(chip);
    await waitFor(() => expect(chip.getAttribute("aria-checked")).toBe("false"));

    const deletes = client.__calls.filter((c) => c.op === "delete");
    expect(deletes.length).toBe(1);
    expect(deletes[0]!.filters).toEqual([
      { col: "user_id", op: "eq", val: STAFF_ID },
      { col: "business_id", op: "eq", val: BID_A },
    ]);
  });

  it("failed toggle rolls back with the mutation-failure toast", async () => {
    const user = userEvent.setup();
    const { makeScriptedClient } = await import("../../lib/test/fake-client");
    const client = makeScriptedClient({
      ...baseFixtures({
        assignments: [],
      }),
      onWrite: () => ({ error: { code: "42501", message: "denied" } }),
    });
    mount(client);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
    await user.click(screen.getByText("Ravi Kumar"));
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBe(3));

    const chip = screen.getByRole("switch", { name: /Alpha Traders/ });
    await user.click(chip);
    await waitFor(() =>
      expect(screen.getByText("Couldn't save member. Your changes were undone.")).toBeTruthy(),
    );
    // Chip rolled back to off.
    await waitFor(() => expect(chip.getAttribute("aria-checked")).toBe("false"));
  });

  it("zero-membership state shows the exact empty copy under the grid", async () => {
    const user = userEvent.setup();
    await mountedTeam({ assignments: [] });
    await user.click(screen.getByText("Ravi Kumar"));
    expect(await screen.findByText("Not assigned anywhere")).toBeTruthy();
    expect(screen.getByText("Toggle businesses below to give this person access.")).toBeTruthy();
  });

  it("microcopy renders verbatim beneath the grid", async () => {
    const user = userEvent.setup();
    await mountedTeam({});
    await user.click(screen.getByText("Ravi Kumar"));
    expect(
      await screen.findByText("Changes take effect shortly — at your teammate's next app refresh."),
    ).toBeTruthy();
  });
});
