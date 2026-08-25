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
import { restoreSession, signOutLocal, type GoTrueSessionJSON } from "@billing/api/auth";
import { createBillingClient } from "@billing/api/client";
import { resolveSessionStorage } from "@billing/api/session-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readBillingEnv } from "../lib/env";
import { setSessionState } from "../lib/session-seam";
import {
  startAuthFailureInterceptor,
  withAuthFailureSuppressed,
} from "./interceptor";

export interface ProfileRow {
  id: string;
  role: string;
  is_active: boolean;
  locked_at: string | null;
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
   * THE permission predicate source (T-3-10): resolved from the
   * server-controlled profiles row via RLS - never JWT metadata.
   */
  role: string | null;
  signOut: () => Promise<void>;
}

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
      .select("id,role,is_active,locked_at")
      .eq("id", data.user.id)
      .maybeSingle();
    return (res.data as ProfileRow | null) ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children, authClient, getProfile, authRouter }: AuthProviderProps) {
  const [phase, setPhase] = useState<Phase>({ status: "restoring" });
  const [session, setSession] = useState<GoTrueSessionJSON | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
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
      setPhase({ status: restored.status, client });
      setSessionState(restored.status);
    })();
    return () => {
      cancelled = true;
    };
  }, [authClient]);

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
    setSessionState("unauthenticated");
    navigateToLogin();
  }, [navigateToLogin]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: phase.status,
      session,
      profile,
      role: profile?.role ?? null,
      signOut,
    }),
    [phase.status, session, profile, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {phase.status === "restoring" ? null : children}
    </AuthContext.Provider>
  );
}
