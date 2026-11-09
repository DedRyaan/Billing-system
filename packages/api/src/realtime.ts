// Business-scoped realtime subscriptions (D-81): postgres_changes channels
// filtered business_id=eq.{id} so multi-device views stay live WITHOUT any
// cross-business traffic. The owner-visible businesses table subscribes
// globally (no filter).
//
// Framework-free by design: no React imports anywhere in packages/api.

import type { SupabaseClient } from "@supabase/supabase-js";

export type RealtimeEntity = "businesses" | "customers" | "catalog_items" | "invoices" | "payments";

export interface RealtimeEventPayload {
  eventType: string;
  new?: unknown;
  old?: unknown;
}

const TENANT_TABLES: ReadonlySet<RealtimeEntity> = new Set([
  "customers",
  "catalog_items",
  "invoices",
  "payments",
]);

export class GlobalScopeNotAllowedError extends Error {
  constructor(entity: RealtimeEntity) {
    super(`Entity "${entity}" is tenant-scoped and cannot subscribe with 'global' scope.`);
    this.name = "GlobalScopeNotAllowedError";
  }
}

export function subscribeToEntity(
  client: SupabaseClient,
  entity: RealtimeEntity,
  businessId: string,
  onEvent: (payload: RealtimeEventPayload) => void,
  /**
   * Distinguishes concurrent subscriptions to the same entity+scope.
   * supabase-js returns the EXISTING channel for a repeated topic, so two
   * independent subscribers must not share a name (one unsubscribe would
   * tear down the other).
   */
  tag?: string,
): () => void {
  if (TENANT_TABLES.has(entity) && businessId === "global") {
    throw new GlobalScopeNotAllowedError(entity);
  }

  const channelName = `entity:${entity}:${businessId}${tag !== undefined ? `:${tag}` : ""}`;
  const channel = client.channel(channelName);
  const filter =
    entity === "businesses" && businessId === "global"
      ? undefined
      : `business_id=eq.${businessId}`;

  channel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: entity,
        ...(filter !== undefined ? { filter } : {}),
      },
      (payload: unknown) => {
        const p = payload as { eventType?: string; new?: unknown; old?: unknown };
        onEvent({
          eventType: p.eventType ?? "UNKNOWN",
          ...(p.new !== undefined ? { new: p.new } : {}),
          ...(p.old !== undefined ? { old: p.old } : {}),
        });
      },
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
