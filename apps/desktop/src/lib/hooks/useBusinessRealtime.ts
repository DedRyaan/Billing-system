// useBusinessRealtime - the D-81 connective tissue (plan 03-06 Task 1).
//
// Subscribes to postgres_changes for one entity scoped to ONE business and
// invalidates exactly the matching keysFor.<entity>(businessId) prefix on
// every pushed change. Realtime is a REFRESH trigger, never an authority:
// the cache is repopulated by the normal query path under RLS (T-3-21/23).
//
// Defensive foreign-event guard: server-side filters make cross-business
// deliveries impossible in production, but a spoofed or buggy payload whose
// row carries a different business_id can never touch our cache slots.
//
// Lifecycle is StrictMode-idempotent: mount -> subscribe, cleanup ->
// unsubscribe; the double-mount remount resubscribes cleanly.
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { keysFor } from "@billing/api/query-keys";
import {
  subscribeToEntity,
  type RealtimeEntity,
  type RealtimeEventPayload,
} from "@billing/api/realtime";
import type { SupabaseClient } from "@supabase/supabase-js";

function invalidatePrefix(qc: QueryClient, entity: RealtimeEntity, scope: string): void {
  switch (entity) {
    case "businesses":
      void qc.invalidateQueries({ queryKey: keysFor.businesses(scope) });
      return;
    case "catalog_items":
      void qc.invalidateQueries({ queryKey: keysFor.catalogItems(scope) });
      return;
    case "customers":
      void qc.invalidateQueries({ queryKey: keysFor.customers(scope) });
      return;
  }
}

/** First business_id found on the event's new/old row, when it carries one. */
function rowBusinessId(payload: RealtimeEventPayload): string | undefined {
  for (const part of [payload.new, payload.old]) {
    if (
      typeof part === "object" &&
      part !== null &&
      typeof (part as Record<string, unknown>)["business_id"] === "string"
    ) {
      return (part as Record<string, unknown>)["business_id"] as string;
    }
  }
  return undefined;
}

/**
 * @param client authenticated SupabaseClient (null = inert, e.g. pre-auth)
 * @param entity table to watch
 * @param businessId tenant scope; omit for the global businesses listing
 */
export function useBusinessRealtime(
  client: SupabaseClient | null,
  entity: RealtimeEntity,
  businessId: string | null | undefined,
): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!client || !businessId) return;
    const scope = businessId;
    const unsubscribe = subscribeToEntity(client, entity, scope, (payload) => {
      // Guard BEFORE any invalidation: rows carry business_id on tenant
      // tables; the global businesses channel has no such column.
      if (scope !== "global") {
        const rowBid = rowBusinessId(payload);
        if (rowBid !== undefined && rowBid !== scope) return;
      }
      invalidatePrefix(qc, entity, scope);
    });
    return unsubscribe;
  }, [client, entity, businessId, qc]);
}
