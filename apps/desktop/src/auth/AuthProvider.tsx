// AuthProvider - restore-before-render, server-controlled role, honest
// sign-out (plan 03-03; AUTH-01/AUTH-05, D-70/D-71/D-72, T-3-10/T-3-12).
//
// Injection-first like every @billing/api consumer: tests pass a scripted
// authClient + getProfile; production composes the real client from env.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  adoptSession,
  restoreSession,
  signIn,
  signOutLocal,
  type GoTrueSessionJSON,
  type SignInResult,
} from "@billing/api/auth";
import { createBillingClient } from "@billing/api/client";
import { resolveSessionStorage } from "@billing/api/session-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAuthCallbackUrl } from "@billing/api/email-auth";
import { readBillingEnv } from "../lib/env";
import { showToast } from "../shell/toast-store";
import { listenForDeepLinks } from "./deepLinks";
import { setBootstrapState, setSessionState } from "../lib/session-seam";
import {
  startAuthFailureInterceptor,
  withAuthFailureSuppressed,
} from "./interceptor";

export interface ProfileRow {
  id: string;
  role: string;
  is_active: boolean;
  locked_at: string | null;
  /** Display fields for shell chrome (sidebar footer, Settings). */
  full_name?: string | null;
  email?: string | null;
  /** Admin-issued temporary password in use: must pick their own first. */
  must_change_password?: boolean;
}

interface AuthRouterLike {
  navigate: (opts: { to: string; search?: Record<string, string> }) => Promise<void> | void;
}

export interface AuthProviderProps {
  children: ReactNode;
  /** Injected client (tests/fakes). Default builds from env + storage seam. */
  authClient?: SupabaseClient;
  /** Injected own-profile probe for the failure interceptor. */
  getProfile?: () => Promise<{ locked_at: string | null; is_active: boolean } | null>;
  /** Router handle for imperative post-signout / failure navigation. */
  authRouter?: AuthRouterLike;
  /**
   * Injected D-73 first-run probe (tests script the answer). Default invokes
   * the deployed bootstrap-status Edge Function over this provider's client.
   */
  bootstrapProbe?: () => Promise<boolean>;
}

type Phase =
  | { status: "restoring" }
  | { status: "authenticated"; client: SupabaseClient }
  | { status: "unauthenticated"; client: SupabaseClient | null };

export interface AuthContextValue {
  status: "restoring" | "authenticated" | "unauthenticated";
  session: GoTrueSessionJSON | null;
  profile: ProfileRow | null;
  /**
   * The authenticated transport for @billing/api modules (D-79 single door
   * into Supabase). Null while restoring or when no client could be built;
   * consumers gate on it instead of constructing their own clients.
   */
  client: SupabaseClient | null;
  /**
   * THE permission predicate source (T-3-10): resolved from the
   * server-controlled profiles row via RLS - never JWT metadata.
   */
  role: string | null;
  signOut: () => Promise<void>;
  /** Edge-Function sign-in over this provider's client (D-79 single door). */
  signInWithPassword: (input: { email: string; password: string }) => Promise<SignInResult>;
  /** Adopt a returned session (sign-in/bootstrap mint) into the auth stack. */
  adoptReturnedSession: (
    sessionJson: GoTrueSessionJSON,
  ) => Promise<{ ok: boolean; reason?: string }>;
  /** Edge Function transport over this provider's client (D-79 single door). */
  invokeFunction: (
    fn: string,
    opts?: { body?: unknown },
  ) => Promise<{ data: unknown; error: unknown }>;
  /** Re-read the own profile row (e.g. after clearing must_change_password). */
  refreshProfile: () => Promise<void>;
  /**
   * Signed in through a password-reset email (link or code): the app shows
   * the choose-a-new-password screen until endPasswordRecovery().
   */
  passwordRecovery: boolean;
  /** Adopt a session from an email code; recovery sessions open the reset screen. */
  adoptEmailSession: (
    sessionJson: GoTrueSessionJSON,
    opts: { recovery: boolean },
  ) => Promise<{ ok: boolean; reason?: string }>;
  endPasswordRecovery: () => void;
  /** Message for the sign-in screen about an email link that failed. */
  linkNotice: string | null;
  clearLinkNotice: () => void;
}

export const EXPIRED_LINK_NOTICE =
  "That email link has expired or was already used. Request a new one, or type the code from the email.";
const OTHER_ACCOUNT_LINK_NOTICE =
  "That email link is for a different account. Sign out first, then open the link again.";

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

async function fetchOwnProfileRow(client: SupabaseClient): Promise<ProfileRow | null> {
  try {
    const { data } = await client.auth.getUser();
    if (!data.user) return null;
    const res = await client
      .from("profiles")
      .select("id,role,is_active,locked_at,full_name,email,must_change_password")
      .eq("id", data.user.id)
      .maybeSingle();
    return (res.data as ProfileRow | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * D-73 server truth: does ANY profile exist? Anon-safe single-boolean Edge
 * Function (T-3-11). Throws on transport/payload failure - the caller holds
 * the seam at 'unknown' so guards degrade open instead of misrouting launch.
 * Bounded: supabase-js invoke has no default timeout, and a hung probe must
 * never hold the restoring gate shut.
 */
const BOOTSTRAP_PROBE_TIMEOUT_MS = 4000;

async function probeBootstrapStatus(client: SupabaseClient): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const invoke = client.functions.invoke("bootstrap-status", { body: {} });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("bootstrap-status probe timed out")),
        BOOTSTRAP_PROBE_TIMEOUT_MS,
      );
    });
    const envelope = (await Promise.race([invoke, timeout])) as {
      data?: unknown;
      error?: unknown;
    };
    if (envelope.error !== null && envelope.error !== undefined) {
      throw new Error("bootstrap-status probe failed");
    }
    const payload = envelope.data;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { bootstrapped?: unknown }).bootstrapped !== "boolean"
    ) {
      throw new Error("bootstrap-status returned an unusable payload");
    }
    return (payload as { bootstrapped: boolean }).bootstrapped;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function AuthProvider({
  children,
  authClient,
  getProfile,
  authRouter,
  bootstrapProbe,
}: AuthProviderProps) {
  const [phase, setPhase] = useState<Phase>({ status: "restoring" });
  const [session, setSession] = useState<GoTrueSessionJSON | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Restore BEFORE first paint decision - children stay gated on 'restoring',
  // so no half-auth flash is possible.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let client: SupabaseClient | null = null;
      if (authClient) {
        client = authClient;
      } else {
        try {
          const storage = await resolveSessionStorage();
          client = createBillingClient(
            readBillingEnv(import.meta.env as unknown as Record<string, unknown>),
            { storage },
          );
        } catch {
          client = null;
        }
      }
      if (cancelled) return;
      if (!client) {
        setPhase({ status: "unauthenticated", client: null });
        setSessionState("unauthenticated");
        return;
      }
      const restored = await restoreSession(client);
      if (cancelled) return;
      // D-73 first-run truth (CR-01): settle the bootstrap seam BEFORE the
      // restoring gate lifts, so every route guard sees server truth on the
      // FIRST navigation - fresh installs land on /bootstrap; established
      // installs make /bootstrap unreachable forever (state no longer resets
      // to 'unknown' every launch).
      try {
        const bootstrapped = bootstrapProbe
          ? await bootstrapProbe()
          : await probeBootstrapStatus(client);
        if (!cancelled) setBootstrapState(bootstrapped ? "bootstrapped" : "unbootstrapped");
      } catch {
        // Probe unreachable (offline launch / function down): hold 'unknown'.
        // Guards degrade open - no forced /bootstrap on a flaky network.
      }
      if (cancelled) return;
      setPhase({ status: restored.status, client });
      setSessionState(restored.status);
    })();
    return () => {
      cancelled = true;
    };
  }, [authClient, bootstrapProbe]);

  // Server-controlled profile fetch once authenticated (role source of truth).
  useEffect(() => {
    if (phase.status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      const row = await fetchOwnProfileRow(phase.client);
      if (!cancelled) setProfile(row);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const navigateToLogin = useCallback(
    (reason?: string) => {
      void authRouter?.navigate({ to: "/login", ...(reason ? { search: { reason } } : {}) });
    },
    [authRouter],
  );

  // Failure interceptor lives exactly as long as the provider does.
  useEffect(() => {
    if (phase.status === "restoring" || !phase.client) return;
    const stop = startAuthFailureInterceptor(
      phase.client,
      (reason) => {
        setPhase((p) =>
          p.status === "restoring" ? p : { ...p, status: "unauthenticated" },
        );
        setSession(null);
        // WR-03: the failure path ends THIS identity - its cached profile
        // (sidebar name, role predicate) must not survive into the next one.
        setProfile(null);
        setSessionState("unauthenticated");
        navigateToLogin(reason);
      },
      getProfile ? { getProfile } : {},
    );
    return stop;
  }, [phase, getProfile, navigateToLogin]);

  const signOut = useCallback(async () => {
    const current = phaseRef.current;
    if (current.status === "restoring" || !current.client) return;
    // Suppression covers the awaited call AND the local SIGNED_OUT echo -
    // explicit sign-out never routes through the failure taxonomy.
    await withAuthFailureSuppressed(async () => {
      await signOutLocal(current.client as SupabaseClient);
    });
    setPhase({ status: "unauthenticated", client: current.client });
    setSession(null);
    setProfile(null);
    setPasswordRecovery(false);
    setSessionState("unauthenticated");
    navigateToLogin();
  }, [navigateToLogin]);

  const signInWithPassword = useCallback(
    async (input: { email: string; password: string }) => {
      const p = phaseRef.current;
      const client = p.status === "restoring" ? null : p.client;
      if (!client) return { ok: false as const, reason: "network" as const };
      return signIn({ client }, input);
    },
    [],
  );

  const adoptReturnedSession = useCallback(
    async (sessionJson: GoTrueSessionJSON) => {
      const current = phaseRef.current;
      if (current.status === "restoring" || !current.client) {
        return { ok: false, reason: "unknown" };
      }
      // WR-03: the returned session may be a DIFFERENT identity (bootstrap
      // mint, post-logout sign-in). Drop the previous user's profile first so
      // role-gated chrome never renders the wrong identity's value.
      setProfile(null);
      const res = await adoptSession(current.client, sessionJson);
      if (!res.ok) return { ok: false, reason: res.reason };
      setPhase({ status: "authenticated", client: current.client });
      setSession(sessionJson);
      setSessionState("authenticated");
      return { ok: true };
    },
    [],
  );

  const adoptEmailSession = useCallback(
    async (sessionJson: GoTrueSessionJSON, opts: { recovery: boolean }) => {
      // Flag first so the reset screen renders straight away - the app shell
      // never flashes for a recovery session.
      if (opts.recovery) setPasswordRecovery(true);
      const res = await adoptReturnedSession(sessionJson);
      if (!res.ok && opts.recovery) setPasswordRecovery(false);
      if (res.ok) setLinkNotice(null);
      return res;
    },
    [adoptReturnedSession],
  );

  const endPasswordRecovery = useCallback(() => setPasswordRecovery(false), []);
  const clearLinkNotice = useCallback(() => setLinkNotice(null), []);

  // Email links arrive as settle://auth/callback#access_token=... (see
  // @billing/api/email-auth). Listen once the client exists.
  const clientReady = phase.status !== "restoring" && phase.client !== null;
  useEffect(() => {
    if (!clientReady) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const handle = async (url: string) => {
      const parsed = parseAuthCallbackUrl(url);
      if (parsed === null) return;
      const current = phaseRef.current;
      if (parsed.kind === "error") {
        if (current.status === "authenticated") {
          showToast({ variant: "error", message: EXPIRED_LINK_NOTICE });
        } else {
          setLinkNotice(EXPIRED_LINK_NOTICE);
        }
        return;
      }
      if (current.status === "authenticated" && current.client) {
        // Never silently swap identities: a link for another account is
        // refused while someone is signed in on this device.
        const { data } = await current.client.auth.getSession();
        const currentUserId = data.session?.user.id ?? null;
        if (currentUserId !== null && parsed.userId !== currentUserId) {
          showToast({ variant: "error", message: OTHER_ACCOUNT_LINK_NOTICE });
          return;
        }
      }
      const res = await adoptEmailSession(parsed.session, {
        recovery: parsed.type === "recovery",
      });
      if (!res.ok) {
        setLinkNotice(EXPIRED_LINK_NOTICE);
        return;
      }
      if (current.status !== "authenticated") void authRouter?.navigate({ to: "/dashboard" });
    };
    void listenForDeepLinks((url) => void handle(url)).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [clientReady, adoptEmailSession, authRouter]);

  const invokeFunction = useCallback(
    async (fn: string, opts?: { body?: unknown }) => {
      const p = phaseRef.current;
      const client = p.status === "restoring" ? null : p.client;
      if (!client) return { data: null, error: { name: "NoClientError" } };
      return (await client.functions.invoke(
        fn,
        opts as Parameters<typeof client.functions.invoke>[1],
      )) as { data: unknown; error: unknown };
    },
    [],
  );

  const refreshProfile = useCallback(async () => {
    const p = phaseRef.current;
    if (p.status !== "authenticated") return;
    setProfile(await fetchOwnProfileRow(p.client));
  }, []);

  // Null while restoring (no half-auth transport exposure); otherwise the
  // phase's client - even unauthenticated keeps its (inert) client reference
  // for sign-in retry paths.
  const dataClient = phase.status === "restoring" ? null : phase.client;

  const value = useMemo<AuthContextValue>(
    () => ({
      status: phase.status,
      session,
      profile,
      client: dataClient,
      role: profile?.role ?? null,
      signOut,
      signInWithPassword,
      adoptReturnedSession,
      invokeFunction,
      refreshProfile,
      passwordRecovery,
      adoptEmailSession,
      endPasswordRecovery,
      linkNotice,
      clearLinkNotice,
    }),
    [
      phase.status,
      dataClient,
      session,
      profile,
      signOut,
      signInWithPassword,
      adoptReturnedSession,
      invokeFunction,
      refreshProfile,
      passwordRecovery,
      adoptEmailSession,
      endPasswordRecovery,
      linkNotice,
      clearLinkNotice,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {phase.status === "restoring" ? null : children}
    </AuthContext.Provider>
  );
}
