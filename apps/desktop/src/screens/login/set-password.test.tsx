// SetPasswordScreen + brand/login-details helpers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setOwnPassword } from "@billing/api/memberships";
import { SetPasswordScreen } from "./SetPasswordScreen";
import { LOGIN_PHRASES, pickLoginPhrase } from "../../lib/strings/brand";
import { loginDetailsMessage } from "../../lib/strings/team";

vi.mock("@billing/api/memberships", () => ({ setOwnPassword: vi.fn() }));
const refreshProfile = vi.fn(async () => undefined);
const signOut = vi.fn(async () => undefined);
vi.mock("../../auth/AuthProvider", () => ({
  useAuth: () => ({
    client: {},
    profile: { full_name: "Priya Shah" },
    refreshProfile,
    signOut,
    passwordRecovery: false,
    endPasswordRecovery: () => undefined,
  }),
}));

const setOwnPasswordMock = vi.mocked(setOwnPassword);

beforeEach(() => {
  setOwnPasswordMock.mockReset();
  refreshProfile.mockClear();
});

async function fill(pw: string, confirm: string) {
  const user = userEvent.setup();
  render(<SetPasswordScreen />);
  await user.type(screen.getByLabelText("New password"), pw);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
}

describe("SetPasswordScreen", () => {
  it("greets the person and blocks short passwords", async () => {
    await fill("short", "short");
    expect(screen.getByText(/Welcome, Priya\./)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 8 characters.");
    expect(setOwnPasswordMock).not.toHaveBeenCalled();
  });

  it("blocks mismatched confirmation", async () => {
    await fill("a-long-secret", "a-long-secreT");
    expect(screen.getByRole("alert")).toHaveTextContent("don't match");
    expect(setOwnPasswordMock).not.toHaveBeenCalled();
  });

  it("saves, then refreshes the profile so the app shell can render", async () => {
    setOwnPasswordMock.mockResolvedValue({ ok: true, data: undefined });
    await fill("a-long-secret", "a-long-secret");
    await waitFor(() => expect(refreshProfile).toHaveBeenCalled());
    expect(setOwnPasswordMock).toHaveBeenCalledWith({}, "a-long-secret");
  });

  it("shows the server's reason when the update is refused", async () => {
    setOwnPasswordMock.mockResolvedValue({
      ok: false,
      error: { reason: "VALIDATION_FAILED", message: "Choose a password different from the temporary one.", pgCode: "auth" },
    });
    await fill("a-long-secret", "a-long-secret");
    expect(await screen.findByRole("alert")).toHaveTextContent("different from the temporary one");
    expect(refreshProfile).not.toHaveBeenCalled();
  });
});

describe("brand helpers", () => {
  it("picks a phrase from the list deterministically for a given random value", () => {
    expect(pickLoginPhrase(() => 0, null)).toBe(LOGIN_PHRASES[0]);
    expect(pickLoginPhrase(() => 0.9999, null)).toBe(LOGIN_PHRASES[LOGIN_PHRASES.length - 1]);
    expect(new Set(LOGIN_PHRASES).size).toBe(LOGIN_PHRASES.length);
  });

  it("never repeats the previous visit's phrase", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let prev = pickLoginPhrase(() => 0.5, storage);
    for (let n = 0; n < 50; n++) {
      const next = pickLoginPhrase(() => (n * 0.137) % 1, storage);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it("builds a shareable login-details message", () => {
    const msg = loginDetailsMessage({ appName: "Bahi", name: "Priya", email: "p@x.in", password: "T3mp!pass" });
    expect(msg.split("\n")).toEqual([
      "Hi Priya, here are your Bahi login details:",
      "Email: p@x.in",
      "Temporary password: T3mp!pass",
      "You'll be asked to choose your own password when you sign in.",
    ]);
  });
});
