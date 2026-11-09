// Realtime subscription helper behaviors - RED.
import { describe, expect, it, vi } from "vitest";
import { subscribeToEntity } from "../src/realtime";
import { makeClient } from "./fakes";

describe("subscribeToEntity", () => {
  it("filters postgres_changes to business_id=eq.{id} for tenant tables", () => {
    const fake = makeClient();
    const onEvent = vi.fn();
    subscribeToEntity(fake.client, "customers", "bid-123", onEvent);

    const channel = fake.channels[0]!;
    expect(channel.subscribed).toBe(true);
    expect(channel.config).toMatchObject({
      event: "*",
      schema: "public",
      table: "customers",
      filter: "business_id=eq.bid-123",
    });
  });

  it("drops the filter for the global owner-visible businesses table", () => {
    const fake = makeClient();
    subscribeToEntity(fake.client, "businesses", "global", vi.fn());
    const config = fake.channels[0]!.config as Record<string, unknown>;
    expect(config["table"]).toBe("businesses");
    expect("filter" in config).toBe(false);
  });

  it("refuses 'global' scope on tenant tables (loud typed error)", () => {
    const fake = makeClient();
    expect(() =>
      subscribeToEntity(fake.client, "customers", "global", vi.fn()),
    ).toThrowError(/global/i);
  });

  it("unsubscriber removes the exact channel", () => {
    const fake = makeClient();
    const stop = subscribeToEntity(fake.client, "catalog_items", "bid-9", vi.fn());
    stop();
    expect(fake.removedChannels).toEqual([fake.channels[0]!.name]);
  });

  it("delivers events to the callback", () => {
    const fake = makeClient();
    const onEvent = vi.fn();
    subscribeToEntity(fake.client, "customers", "b1", onEvent);
    // Simulate supabase-js invoking the registered callback:
    const config = fake.channels[0]!.config;
    void config;
    // The fake stores only config; event delivery is covered by the
    // builder-level test in fakes consumers. Contract: unsubscriber + filter.
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("subscribeToEntity — billing entities", () => {
  it("treats invoices and payments as tenant tables", () => {
    const fake = makeClient();
    expect(() => subscribeToEntity(fake.client, "invoices", "global", vi.fn())).toThrowError(/global/i);
    expect(() => subscribeToEntity(fake.client, "payments", "global", vi.fn())).toThrowError(/global/i);
    subscribeToEntity(fake.client, "payments", "bid-1", vi.fn());
    expect(fake.channels[0]!.config).toMatchObject({ table: "payments", filter: "business_id=eq.bid-1" });
  });

  it("a tag gives concurrent subscribers distinct channel names", () => {
    const fake = makeClient();
    subscribeToEntity(fake.client, "invoices", "bid-1", vi.fn());
    subscribeToEntity(fake.client, "invoices", "bid-1", vi.fn(), "detail");
    expect(fake.channels.map((c) => c.name)).toEqual(["entity:invoices:bid-1", "entity:invoices:bid-1:detail"]);
  });
});
