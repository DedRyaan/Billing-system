// Settings assembly contracts (plan 03-10 Task 3, AUTH-05/T-3-40).
// Staff variant hides Team ENTIRELY; sign-out fires once; version falls back
// headlessly; quiet footer note verbatim.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeScriptedClient } from "../../lib/test/fake-client";
import { SettingsScreen } from "./SettingsScreen";
import { AuthProvider } from "../../auth/AuthProvider";
import { QUIET_FOOTER_NOTE } from "../../lib/strings/settings";

const SESSION = { access_token: "at", refresh_token: "rt" };

function fixtures(role: string) {
  return {
    session: SESSION,
    profileRow: { id: "user-1", role, is_active: true, locked_at: null, full_name: "Asha Patil", email: "asha@billing.test" },
    tables: {
      profiles: [{ id: "user-1", role, is_active: true, locked_at: null, full_name: "Asha Patil", email: "asha@billing.test" }],
      businesses: [],
      business_members: [],
    },
  };
}

function mount(client: ReturnType<typeof makeScriptedClient>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <AuthProvider authClient={client} authRouter={{ navigate: vi.fn() }}>
      <QueryClientProvider client={qc}>
        <SettingsScreen />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe("SettingsScreen", () => {
  it("admin variant renders Account + Team + Session + About with role badge", async () => {
    mount(makeScriptedClient(fixtures("super_admin")));
    await waitFor(() => expect(screen.getByTestId("team-section")).toBeTruthy());
    expect(screen.getByTestId("account-block").textContent).toContain("Asha Patil");
    expect(screen.getByTestId("account-block").textContent).toContain("asha@billing.test");
    expect(screen.getByText("Admin").textContent).toBe("Admin"); // account badge
    expect(screen.getByTestId("settings-signout")).toBeTruthy();
  });

  it("STAFF variant hides the Team section entirely (zero team DOM nodes)", async () => {
    mount(makeScriptedClient(fixtures("staff")));
    await waitFor(() => expect(screen.getByTestId("account-block")).toBeTruthy());
    // Give any lazy Team mounting a chance to prove absence.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("team-section")).toBeNull();
    expect(document.querySelector("[aria-label='Team']")).toBeNull();
    expect(screen.getByText("Staff")).toBeTruthy();
  });

  it("sign-out wiring invokes AuthProvider.signOut exactly once", async () => {
    const user = userEvent.setup();
    const client = makeScriptedClient(fixtures("staff"));
    mount(client);
    await waitFor(() => expect(screen.getByTestId("settings-signout")).toBeTruthy());
    const signOutMock = (client.auth as unknown as { signOut: ReturnType<typeof vi.fn> }).signOut;
    const calls = signOutMock.mock.calls.length;
    await user.click(screen.getByTestId("settings-signout"));
    await waitFor(() => {
      expect(
        (client.auth as unknown as { signOut: ReturnType<typeof vi.fn> }).signOut.mock.calls.length,
      ).toBe(calls + 1);
    });
  });

  it("About renders app name + version fallback headlessly; quiet note verbatim", async () => {
    mount(makeScriptedClient(fixtures("staff")));
    await waitFor(() => expect(screen.getByTestId("about-version").textContent).toContain("Version"));
    expect(screen.getByText(QUIET_FOOTER_NOTE)).toBeTruthy();
  });
});
