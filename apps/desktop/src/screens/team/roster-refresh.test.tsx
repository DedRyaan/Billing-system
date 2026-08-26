// WR-08 regression suite: a successful deactivate/reactivate must refresh
// the ROSTER TABLE immediately (invalidate the roster query) - previously
// only the open sheet's local badge flipped and the table kept showing
// Active until an unrelated refetch fired.
import { expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastHost } from "../../shell/ToastHost";
import { makeScriptedClient, type ScriptedClientOptions } from "../../lib/test/fake-client";
import { TeamSection } from "./TeamSection";

const STAFF_ID = "staff-1";
const ADMIN_ID = "admin-me";

function base(): ScriptedClientOptions {
  return {
    session: { access_token: "at", refresh_token: "rt" },
    profileRow: {
      id: ADMIN_ID,
      role: "super_admin",
      is_active: true,
      locked_at: null,
      full_name: "Asha Patil",
      email: "asha@billing.test",
    },
    tables: {
      profiles: [
        {
          id: STAFF_ID,
          email: "ravi@billing.test",
          full_name: "Ravi Kumar",
          role: "staff",
          is_active: true,
          locked_at: null,
        },
        {
          id: ADMIN_ID,
          email: "asha@billing.test",
          full_name: "Asha Patil",
          role: "super_admin",
          is_active: true,
          locked_at: null,
        },
      ],
      businesses: [],
      business_members: [],
    },
  };
}

it("deactivate success invalidates the roster so the table flips to Deactivated (WR-08)", async () => {
  const user = userEvent.setup();
  const client = makeScriptedClient(base());
  let rosterSelects = 0;
  // Wrap from() to count roster reads of the profiles table.
  const innerFrom = client.from.bind(client);
  (client as unknown as { from: unknown }).from = (table: string) => {
    if (table === "profiles") rosterSelects += 1;
    return innerFrom(table);
  };

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TeamSection client={client} />
      <ToastHost />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeTruthy());
  const selectsBeforeSheet = rosterSelects;

  // Open the person sheet and run the deactivate confirm.
  await user.click(screen.getByText("Ravi Kumar"));
  await user.click(await screen.findByRole("button", { name: "Deactivate…" }));
  await user.click(await screen.findByRole("button", { name: "Deactivate account" }));

  await waitFor(() => {
    expect(client.__calls.some((c) => c.table === "rpc:deactivate_staff_account")).toBe(true);
  });

  // WR-08: a NEW roster read fires after lifecycle success.
  await waitFor(() => expect(rosterSelects).toBeGreaterThan(selectsBeforeSheet));
});
