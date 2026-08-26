// PersonSheet lifecycle contracts (plan 03-10 Task 2, AUTH-04/T-3-37/38/39).
// Verbatim confirms -> Phase 1 RPCs; staff targets only; optimistic status
// badge flip with loud failure mapping.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { PersonSheet } from "./TeamSection";
import type { ProfileSummary } from "@billing/api/memberships";

const person: ProfileSummary = {
  id: "staff-9",
  email: "ravi@billing.test",
  full_name: "Ravi Kumar",
  role: "staff",
  is_active: true,
  locked_at: null,
};

function base(): ScriptedClientOptions {
  return {
    session: { access_token: "at", refresh_token: "rt" },
    tables: {
      businesses: [],
      business_members: [],
      profiles: [person],
    },
  };
}

function mount(client: ReturnType<typeof makeScriptedClient>, p: ProfileSummary = person) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PersonSheet open onClose={vi.fn()} client={client} person={p} />
    </QueryClientProvider>,
  );
}

describe("deactivate flow", () => {
  it("active staff shows Deactivate… -> exact confirm -> 'Deactivate account' RPC", async () => {
    const user = userEvent.setup();
    const client = makeScriptedClient(base());
    mount(client);

    await user.click(await screen.findByRole("button", { name: "Deactivate…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Deactivate Ravi Kumar?");
    expect(dialog.textContent).toContain(
      "They'll be signed out everywhere within seconds and can't sign in until reactivated. Their name stays on past bills.",
    );
    await user.click(screen.getByRole("button", { name: "Deactivate account" }));

    await waitFor(() => {
      expect(
        client.__calls.some((c) => c.table === "rpc:deactivate_staff_account"),
      ).toBe(true);
    });
    const rpc = client.__calls.find((c) => c.table === "rpc:deactivate_staff_account")!;
    expect(rpc.payload).toEqual({ p_target: person.id });
    // Optimistic badge flip.
    await waitFor(() => expect(screen.getAllByText("Deactivated").length).toBeGreaterThan(0));
  });

  it("admin targets NEVER render lifecycle controls (D-11 mirror)", () => {
    mount(makeScriptedClient(base()), { ...person, id: "admin-2", role: "admin" });
    expect(screen.queryByRole("button", { name: "Deactivate…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reactivate…" })).toBeNull();
  });

  it("locked accounts surface no unlock control (documented opt-out)", async () => {
    mount(makeScriptedClient(base()), { ...person, locked_at: "2026-01-01T00:00:00Z" });
    await screen.findByRole("button", { name: "Deactivate…" });
    expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull();
  });
});

describe("reactivate flow", () => {
  it("deactivated staff gets Reactivate confirm -> reactivate_staff RPC", async () => {
    const user = userEvent.setup();
    const client = makeScriptedClient(base());
    mount(client, { ...person, is_active: false });

    await user.click(await screen.findByRole("button", { name: "Reactivate…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Reactivate Ravi Kumar?");
    expect(dialog.textContent).toContain("They regain access to their assigned businesses on next sign-in.");
    await user.click(screen.getByRole("button", { name: "Reactivate" }));

    await waitFor(() => {
      expect(
        client.__calls.some((c) => c.table === "rpc:reactivate_staff_account"),
      ).toBe(true);
    });
    const rpc = client.__calls.find((c) => c.table === "rpc:reactivate_staff_account")!;
    expect(rpc.payload).toEqual({ p_target: person.id });
    await waitFor(() => expect(screen.getAllByText("Active").length).toBeGreaterThan(0));
  });
});
