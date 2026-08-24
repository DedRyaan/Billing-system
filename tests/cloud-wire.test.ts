// Live-cloud wire posture probes (plan 01-13, gap cluster G3): three
// read-only or denied-by-design assertions against the linked production
// project, using ONLY the pre-existing SUPABASE_URL / SUPABASE_ANON_KEY
// secrets. No cloud service-role path exists here by policy.
//
// Probe 1 pins the keep-alive contract (health_check answers HTTP 200 "ok").
// Probe 2 is the security twin of counters.rpc.test.ts: the anon role must be
// DENIED EXECUTE on allocate_next_number over the real API (SQLSTATE 42501).
// Probe 3 pins public signup closure (HTTP 422 disabled-signup rejection;
// status-only assertion to stay robust across GoTrue versions).
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

// Honest live-cloud gating: without the linked-project secrets this suite has
// no subject; CI always provides them.
const cloudWired = Boolean(url && anonKey);

describe("live cloud wire posture (linked project)", () => {
  const itCloud = it.skipIf(!cloudWired);

  itCloud("health_check answers HTTP 200 ok through PostgREST", async () => {
    const response = await fetch(new URL("/rest/v1/rpc/health_check", url!), {
      method: "POST",
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${anonKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.status).toBe(200);
    // PostgREST serializes the scalar either bare or JSON-encoded across
    // versions; accept both spellings of the constant.
    expect(["ok", '"ok"']).toContain((await response.text()).trim());
  });

  itCloud("anon is DENIED EXECUTE on allocate_next_number (SC-4 security twin)", async () => {
    const anon = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Throwaway random scope: never a real business id; nothing logged.
    const { error } = await anon.rpc("allocate_next_number", {
      p_business_id: crypto.randomUUID(),
      p_fy: "wire-probe",
      p_series: "invoice",
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  itCloud("public signup stays closed (disabled-signup rejection)", async () => {
    const response = await fetch(new URL("/auth/v1/signup", url!), {
      method: "POST",
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `wire-probe-${crypto.randomUUID()}@example.invalid`,
        password: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    // Status only — body wording varies across GoTrue versions.
    expect(response.status).toBe(422);
  });
});
