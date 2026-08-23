// SC-4 wire-level proof: N parallel allocate_next_number() RPC calls through
// the real API surface must collect N distinct consecutive integers — the set
// {1..n}, no duplicates, no holes (allocation order itself is serialized by the
// counter row lock; only the SET is asserted, per SC4-ordering).
//
// Uses the SERVICE-role key: allocation is definer-side machinery (EXECUTE is
// revoked from anon/authenticated), never a user-facing path.
//
// Rollback-no-burn on the wire: PostgREST executes each RPC inside its own
// implicit transaction and exposes no BEGIN/ROLLBACK spanning an allocation,
// and no raw `pg` client is installed in this workspace. Per the plan's stated
// fallback, that guarantee stays proven at the SQL tier in
// supabase/tests/counters_allocator.test.sql (SAVEPOINT abort reissues the
// number); this file documents that choice rather than faking a wire rollback.
//
// Scope isolation between runs: `fy` is free-text in Phase 1, so every test
// derives a fresh UUID-suffixed FY label — each run exercises virgin counter
// scopes regardless of prior local-stack state.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_LOCAL_URL;
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "SUPABASE_LOCAL_URL / SUPABASE_LOCAL_SERVICE_KEY are required (see tests/global-setup.ts)",
  );
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

function randChars(length: number, chars: string): string {
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** 15-char structural GSTIN shape (state code + PAN stem + dummy checksums). */
function randomGstin(): string {
  return `${randChars(2, DIGITS)}${randChars(5, LETTERS)}${randChars(4, DIGITS)}A1Z${randChars(1, DIGITS)}`;
}

function freshFy(): string {
  return `t-${crypto.randomUUID().slice(0, 8)}`;
}

describe("allocate_next_number concurrency (Roadmap SC-4)", () => {
  let admin: SupabaseClient;
  const businessIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const legalName of ["RPC Proof Biz A", "RPC Proof Biz B"]) {
      const { data, error } = await admin
        .from("businesses")
        .insert({
          legal_name: legalName,
          gstin: randomGstin(),
          number_format: "prefix_fy_seq",
          prefix: "RPCT",
        })
        .select("id")
        .single();
      expect(error, JSON.stringify(error)).toBeNull();
      businessIds.push((data as { id: string }).id);
    }
  });

  afterAll(async () => {
    if (businessIds.length > 0 && admin) {
      await admin.from("businesses").delete().in("id", businessIds);
    }
  });

  it("8 concurrent allocations for one scope return exactly {1..8}", async () => {
    const businessId = businessIds[0];
    const fy = freshFy();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        admin.rpc("allocate_next_number", {
          p_business_id: businessId,
          p_fy: fy,
          p_series: "invoice",
        }),
      ),
    );

    for (const response of responses) {
      expect(response.error, JSON.stringify(response.error)).toBeNull();
    }

    const values = responses.map((r) => r.data as number);

    // Both contract assertions: duplicate-free AND complete range.
    expect(new Set(values).size).toBe(8);
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("two businesses allocating concurrently never share numbers within their own scopes", async () => {
    const [bizA, bizB] = businessIds;
    const fyA = freshFy();
    const fyB = freshFy();
    const perScope = 6;

    const targets = [
      ...Array.from({ length: perScope }, () => ({ id: bizA, fy: fyA })),
      ...Array.from({ length: perScope }, () => ({ id: bizB, fy: fyB })),
    ];

    const responses = await Promise.all(
      targets.map((t) =>
        admin.rpc("allocate_next_number", {
          p_business_id: t.id,
          p_fy: t.fy,
          p_series: "invoice",
        }),
      ),
    );

    for (const response of responses) {
      expect(response.error, JSON.stringify(response.error)).toBeNull();
    }

    const valuesA = responses.slice(0, perScope).map((r) => r.data as number);
    const valuesB = responses.slice(perScope).map((r) => r.data as number);
    const expectedRange = Array.from({ length: perScope }, (_, i) => i + 1);

    expect(new Set(valuesA).size).toBe(perScope);
    expect([...valuesA].sort((a, b) => a - b)).toEqual(expectedRange);

    expect(new Set(valuesB).size).toBe(perScope);
    expect([...valuesB].sort((a, b) => a - b)).toEqual(expectedRange);
  });
});
