// S1 Sign-in + S2 Bootstrap screen behaviors (plan 03-03 Task 3) - RED.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthProvider } from "../../auth/AuthProvider";
import { LoginScreen } from "./LoginScreen";
import { BootstrapScreen } from "../bootstrap/BootstrapScreen";

/** Fake auth client whose functions.invoke is scripted per test. */
function fakeClientWithInvoke(invoke: ReturnType<typeof vi.fn>): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: "x" } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
    },
    functions: { invoke },
  } as unknown as SupabaseClient;
}

function renderWithAuth(ui: React.ReactElement, client: SupabaseClient) {
  return render(<AuthProvider authClient={client}>{ui}</AuthProvider>);
}

const SESSION = { access_token: "at", refresh_token: "rt", user: { id: "u1" } };

describe("LoginScreen (S1)", () => {
  it("renders the full S1 contract: monogram, Display headline, fields, exact footer caption", async () => {
    const client = fakeClientWithInvoke(vi.fn());
    renderWithAuth(
      <LoginScreen onAuthenticated={vi.fn()} />,
      client,
    );
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("img", { name: "Bahi logo" })).toBeInTheDocument();
    expect(screen.getByTestId("login-phrase").textContent).not.toBe("");
    // Zero signup language anywhere.
    expect(screen.getByText("Accounts are created by invitation by an admin.")).toBeInTheDocument();
    expect(screen.queryByText(/sign up/i)).toBeNull();
  });

  it.each([
    ["locked", "Too many failed attempts. This account is locked — ask an admin to unlock it."],
    ["deactivated", "This account has been deactivated. Contact an admin."],
    ["ended", "Your session ended. Sign in to continue."],
  ] as const)("?reason=%s renders its exact banner", async (reason, copy) => {
    const client = fakeClientWithInvoke(vi.fn());
    renderWithAuth(<LoginScreen initialReason={reason} onAuthenticated={vi.fn()} />, client);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
  });

  it("caps-lock hint tracks the modifier state", async () => {
    const client = fakeClientWithInvoke(vi.fn());
    renderWithAuth(<LoginScreen onAuthenticated={vi.fn()} />, client);
    await screen.findByRole("heading", { name: "Sign in" });
    const password = screen.getByLabelText("Password");

    // jsdom lacks getModifierState; hand-build a bubbling native event that
    // carries the method React's synthetic layer delegates to.
    const capsEvent = (held: boolean): KeyboardEvent =>
      Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), {
        getModifierState: (key: string) => key === "CapsLock" && held,
      }) as unknown as KeyboardEvent;

    fireEvent(password, capsEvent(true));
    expect(screen.getByText("Caps Lock is on")).toBeInTheDocument();

    fireEvent(password, capsEvent(false));
    expect(screen.queryByText("Caps Lock is on")).toBeNull();
  });

  it("generic failure renders the SHARED constant copy byte-exact and never a re-typed string", async () => {
    const http401 = {
      name: "FunctionsHttpError",
      context: {
        json: async () => ({
          error: { code: "invalid_credentials", message: "Invalid email or password." },
        }),
      },
    };
    const invoke = vi.fn().mockResolvedValue({ data: null, error: http401 });
    const { GENERIC_CREDENTIALS_MESSAGE } = await import("@billing/api/errors");
    renderWithAuth(
      <LoginScreen onAuthenticated={vi.fn()} />,
      fakeClientWithInvoke(invoke),
    );
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_CREDENTIALS_MESSAGE);
  });

  it("network failure flips CTA to Try again with calm copy", async () => {
    const invoke = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    renderWithAuth(
      <LoginScreen onAuthenticated={vi.fn()} />,
      fakeClientWithInvoke(invoke),
    );
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText(
        "Couldn't reach the server. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("submitting locks the form, success adopts session and navigates intended path", async () => {
    let release!: (v: unknown) => void;
    // The D-73 bootstrap probe rides the same functions transport at boot
    // (CR-01) - answer it immediately; only the sign-in call stays pending.
    const invoke = vi.fn((fn: string) =>
      fn === "bootstrap-status"
        ? Promise.resolve({ data: { bootstrapped: true }, error: null })
        : new Promise((resolve) => {
            release = resolve;
          }),
    );
    const onAuthenticated = vi.fn();
    renderWithAuth(
      <LoginScreen redirectTo="/customers" onAuthenticated={onAuthenticated} />,
      fakeClientWithInvoke(invoke),
    );
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: /Signing in|Sign in/ })).toBeDisabled();

    release({ data: SESSION, error: null });
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith("/customers"));
  });
});

describe("BootstrapScreen (S2)", () => {
  const BASE = (
    <BootstrapScreen
      invoke={vi.fn()}
      adoptSession={vi.fn().mockResolvedValue({ ok: true })}
      onBootstrapped={vi.fn()}
    />
  );

  it("renders card contract verbatim incl. the deviation fields (mint payload)", async () => {
    render(BASE);
    expect(
      await screen.findByRole("heading", { name: "Set up your workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Enter the owner's setup code to create the first admin account. This screen appears only until setup completes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Setup code")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up owner account" })).toBeInTheDocument();
  });

  it("show-as-typed eye toggle reveals the setup code", async () => {
    render(BASE);
    const code = await screen.findByLabelText("Setup code");
    await userEvent.type(code, "SU-050900129X");
    expect(code).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: /reveal setup code/i }));
    expect(code).toHaveAttribute("type", "text");
  });

  it("invalid setup code shows the exact recovery copy", async () => {
    const http403 = {
      name: "FunctionsHttpError",
      context: { json: async () => ({ error: { code: "invalid_setup_code" } }) },
    };
    render(
      <BootstrapScreen
        invoke={vi.fn().mockResolvedValue({ data: null, error: http403 })}
        adoptSession={vi.fn()}
        onBootstrapped={vi.fn()}
      />,
    );
    await userEvent.type(await screen.findByLabelText("Setup code"), "SU-050900129X");
    await userEvent.type(screen.getByLabelText("Email"), "owner@b.co");
    await userEvent.type(screen.getByLabelText("Full name"), "Owner");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Set up owner account" }));
    expect(
      await screen.findByText("That setup code didn't work. Check it and try again."),
    ).toBeInTheDocument();
  });

  it("success adopts the returned session and hands off to /businesses", async () => {
    const adoptSession = vi.fn().mockResolvedValue({ ok: true });
    const onBootstrapped = vi.fn();
    render(
      <BootstrapScreen
        invoke={vi.fn().mockResolvedValue({
          data: { session: { access_token: "at2", refresh_token: "rt2" } },
          error: null,
        })}
        adoptSession={adoptSession}
        onBootstrapped={onBootstrapped}
      />,
    );
    await userEvent.type(await screen.findByLabelText("Setup code"), "SU-050900129X");
    await userEvent.type(screen.getByLabelText("Email"), "owner@b.co");
    await userEvent.type(screen.getByLabelText("Full name"), "Owner");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Set up owner account" }));
    await waitFor(() =>
      expect(adoptSession).toHaveBeenCalledWith({ access_token: "at2", refresh_token: "rt2" }),
    );
    await waitFor(() => expect(onBootstrapped).toHaveBeenCalled());
  });
});
