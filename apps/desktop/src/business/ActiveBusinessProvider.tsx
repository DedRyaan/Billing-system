// ActiveBusinessProvider - the BIZ-04 enforcement core (plan 03-06, D-67/68/81).
//
// ONE active-business context per device. The provider owns:
//   1. initial resolution from the RLS-truth listing (staff see only assigned
//      businesses; the list query IS the truth - a single assignment
//      auto-selects, admins default to first alphabetical, zero -> null);
//   2. switchBusiness(next): the cache-isolation sweep - EVERY query key whose
//      [1] is a foreign businessId is invalidated by prefix BEFORE selection
//      moves, so no cross-business data can survive a switch (BIZ-04 core,
//      proven by dedicated test); navigation stays within the current section
//      preserving the route slug (D-68);
//   3. archived/read-only truth: isArchived mirrors active row's archived_at
//      so every downstream screen can render read-only chrome (D-35/D-36).
//
// The provider never decides authorization - it only scopes data. Role-based
// affordances keep reading AuthProvider.role.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listBusinesses, type BusinessRow } from "@billing/api/businesses";
import { GLOBAL_BUSINESS, keysFor } from "@billing/api/query-keys";

/** Imperative navigation handle; production adapter wraps TanStack router. */
export interface RouterLike {
  getCurrentPath(): string;
  navigate(opts: { to: string }): unknown;
}

export interface ActiveBusinessContextValue {
  /** The RLS-visible listing - staff assignments and admin universe alike. */
  businesses: BusinessRow[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  activeBusinessId: string | null;
  activeBusiness: BusinessRow | null;
  /** Mirrors archived_at of the active row - drives read-only chrome. */
  isArchived: boolean;
  isActiveBusiness: (businessId: string) => boolean;
  /**
   * Switch context with PROVABLE isolation: sweep-invalidate all foreign
   * business-scoped keys, then move selection and re-enter the current section.
   */
  switchBusiness: (nextId: string) => void;
}

const ActiveBusinessContext = createContext<ActiveBusinessContextValue | null>(null);

export function useActiveBusiness(): ActiveBusinessContextValue {
  const ctx = useContext(ActiveBusinessContext);
  if (!ctx) throw new Error("useActiveBusiness outside ActiveBusinessProvider");
  return ctx;
}

// Entity prefixes derived FROM the factory literals so a new keysFor entry
// can never silently escape the sweep (single source, D-81).
const TENANT_ENTITY_NAMES: ReadonlySet<string> = new Set([
  keysFor.businesses()[0] as string,
  keysFor.customers(GLOBAL_BUSINESS)[0] as string,
  keysFor.catalogItems(GLOBAL_BUSINESS)[0] as string,
  keysFor.memberships(GLOBAL_BUSINESS)[0] as string,
]);

function isForeignTenantKey(key: readonly unknown[], nextId: string): boolean {
  return (
    key.length >= 2 &&
    typeof key[0] === "string" &&
    TENANT_ENTITY_NAMES.has(key[0]) &&
    typeof key[1] === "string" &&
    key[1] !== GLOBAL_BUSINESS &&
    key[1] !== nextId
  );
}

export interface ActiveBusinessProviderProps {
  children: ReactNode;
  /** Injected client (tests script doubles); default comes from useAuth(). */
  dataClient?: SupabaseClient | null;
  /** Navigation handle (production passes the TanStack router adapter). */
  router?: RouterLike;
}

export function ActiveBusinessProvider({
  children,
  dataClient,
  router,
}: ActiveBusinessProviderProps) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const listing = useQuery({
    queryKey: keysFor.businesses(),
    enabled: dataClient !== undefined && dataClient !== null,
    queryFn: async () => {
      // dataClient is non-null here (enabled guard), narrowed for tsc.
      const client = dataClient as SupabaseClient;
      const res = await listBusinesses(client);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const businesses = useMemo<BusinessRow[]>(() => listing.data ?? [], [listing.data]);

  // Initial resolution: first alphabetical accessible business (the module's
  // listing is ordered legal_name asc). Exactly-one staff assignment lands on
  // its single row by the same rule; zero accessible stays null.
  useEffect(() => {
    if (activeId !== null) return;
    if (listing.isLoading || listing.isError) return;
    const first = businesses[0];
    if (first) setActiveId(first.id);
  }, [activeId, businesses, listing.isError, listing.isLoading]);

  const activeBusiness = useMemo(
    () => businesses.find((b) => b.id === activeId) ?? null,
    [businesses, activeId],
  );

  const switchBusiness = useCallback(
    (nextId: string) => {
      // THE isolation sweep (BIZ-04): foreign tenant-scoped prefixes die
      // before selection moves - stale cross-business reads have no key left
      // to hit. Global listings and next-business caches stay untouched.
      void qc.invalidateQueries({
        predicate: (query) => isForeignTenantKey(query.queryKey, nextId),
      });
      setActiveId(nextId);
      // D-68: switching navigates within the current section preserving the
      // route slug - same-path navigation refreshes scoped queries in place.
      const path = router?.getCurrentPath?.() ?? "";
      if (path.length > 0 && path !== "/") router?.navigate({ to: path });
    },
    [qc, router],
  );

  const value = useMemo<ActiveBusinessContextValue>(
    () => ({
      businesses,
      isLoading: listing.isLoading,
      isError: listing.isError,
      refetch: () => void listing.refetch(),
      activeBusinessId: activeId,
      activeBusiness,
      isArchived: activeBusiness?.archived_at != null,
      isActiveBusiness: (id: string) => id === activeId,
      switchBusiness,
    }),
    [businesses, listing.isLoading, listing.isError, listing, activeId, activeBusiness, switchBusiness],
  );

  return <ActiveBusinessContext.Provider value={value}>{children}</ActiveBusinessContext.Provider>;
}
