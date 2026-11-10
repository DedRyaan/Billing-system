// Sign-in screen: email sign-in (magic link + code) and forgot password.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "../../auth/AuthProvider";
import { LoginScreen } from "./LoginScreen";

// Deep links: tests push bahi:// URLs through this handle.
const deepLink = vi.hoisted(() => ({ emit: (_url: string) => undefined as void }));
vi.mock("../../auth/deepLinks", () => ({
  listenForDeepLinks: async (onUrl: (url: string) => void) => {
    deepLink.emit = onUrl;
    return () => undefined;
  },
}));

function fakeClient(auth: Record<string, unknown>): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: "x" } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
      ...auth,
    },
    functions: { invoke: vi.fn() },
  } as unknown as SupabaseClient;
}

const SESSION = { access_token: "at", refresh_token: "rt" };

describe("LoginScreen email flows", () => {
  it("emails a sign-in link, then signs in with the code from it", async () => {
    const user = userEvent.setup();
    const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));
    const verifyOtp = vi.fn(async () => ({ data: { session: SESSION }, error: null }));
    const client = fakeClient({ signInWithOtp, verifyOtp });
    const onAuthenticated = vi.fn();
    render(
      <AuthProvider authClient={client} bootstrapProbe={async () => true}>
        <LoginScreen onAuthenticated={onAuthenticated} />
      </AuthProvider>,
    );

    await user.type(await screen.findByLabelText("Email"), "priya@example.in");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link instead" }));
    expect(screen.getByRole("heading", { name: "Sign in with email" })).toBeInTheDocument();
    // The typed address carries over.
    expect(screen.getByLabelText("Email")).toHaveValue("priya@example.in");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "If an account exists for priya@example.in",
    );
    expect(screen.getByRole("button", { name: /Send another email in \d+s/ })).toBeDisabled();

    await user.type(screen.getByLabelText("Code from the email"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith("/dashboard"));
    expect(verifyOtp).toHaveBeenCalledWith({ email: "priya@example.in", token: "123456", type: "email" });
    expect(client.auth.setSession).toHaveBeenCalledWith(SESSION);
  });

  it("forgot password: sends a reset email and continues with the recovery code", async () => {
    const user = userEvent.setup();
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    const verifyOtp = vi.fn(async () => ({ data: { session: SESSION }, error: null }));
    const client = fakeClient({ resetPasswordForEmail, verifyOtp });
    const onAuthenticated = vi.fn();
    render(
      <AuthProvider authClient={client} bootstrapProbe={async () => true}>
        <LoginScreen onAuthenticated={onAuthenticated} />
      </AuthProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "priya@example.in");
    await user.click(screen.getByRole("button", { name: "Send reset email" }));
    await screen.findByRole("status");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("priya@example.in", {
      redirectTo: "bahi://auth/callback",
    });

    await user.type(screen.getByLabelText("Code from the email"), "654321");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(verifyOtp).toHaveBeenCalledWith({ email: "priya@example.in", token: "654321", type: "recovery" });
  });

  it("'Already have a code?' skips sending, and a wrong code shows a calm error", async () => {
    const user = userEvent.setup();
    const resetPasswordForEmail = vi.fn();
    const verifyOtp = vi.fn(async () => ({
      data: { session: null },
      error: { status: 403, code: "otp_expired", message: "Token has expired or is invalid" },
    }));
    const client = fakeClient({ resetPasswordForEmail, verifyOtp });
    render(
      <AuthProvider authClient={client} bootstrapProbe={async () => true}>
        <LoginScreen onAuthenticated={vi.fn()} />
      </AuthProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email"), "priya@example.in");
    await user.click(screen.getByRole("button", { name: "Already have a code?" }));
    expect(screen.getByRole("status")).toHaveTextContent("Type the code from your password-reset email.");
    expect(resetPasswordForEmail).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Code from the email"), "111111");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is wrong or has expired.");

    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("priya@example.in");
  });
});

function RecoveryProbe() {
  const auth = useAuth();
  return (
    <p data-testid="probe">
      {auth.status}|{String(auth.passwordRecovery)}|{auth.linkNotice ?? ""}
    </p>
  );
}

const jwtFor = (sub: string) => `x.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.y`;

describe("bahi:// email links", () => {
  it("a password-reset link signs in and opens the choose-a-new-password state", async () => {
    const navigate = vi.fn();
    const client = fakeClient({});
    render(
      <AuthProvider authClient={client} bootstrapProbe={async () => true} authRouter={{ navigate }}>
        <RecoveryProbe />
      </AuthProvider>,
    );
    await screen.findByTestId("probe");
    const at = jwtFor("u1");
    deepLink.emit(`bahi://auth/callback#access_token=${at}&refresh_token=rt&type=recovery`);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("authenticated|true|"));
    expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: at, refresh_token: "rt" });
    expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" });
  });

  it("an expired link leaves the person signed out with an explanation", async () => {
    const client = fakeClient({});
    render(
      <AuthProvider authClient={client} bootstrapProbe={async () => true}>
        <RecoveryProbe />
      </AuthProvider>,
    );
    await screen.findByTestId("probe");
    deepLink.emit("bahi://auth/callback#error=access_denied&error_code=otp_expired");
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("unauthenticated|false|That email link has expired"),
    );
    expect(client.auth.setSession).not.toHaveBeenCalled();
  });

  it("refuses a link for a different account while someone is signed in", async () => {
    const client = fakeClient({
      getSession: async () => ({
        data: { session: { access_token: "a", refresh_token: "r", user: { id: "me" } } },
        error: null,
      }),
    });
    render(
      <AuthProvider authClient={client} bootstrapProbe={async () => true}>
        <RecoveryProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("authenticated|false|"));
    deepLink.emit(`bahi://auth/callback#access_token=${jwtFor("someone-else")}&refresh_token=rt&type=magiclink`);
    await new Promise((r) => setTimeout(r, 20));
    expect(client.auth.setSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe")).toHaveTextContent("authenticated|false|");
  });
});
