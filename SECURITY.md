# Security — Accepted Risk Register

Project-wide security posture is enforced in-database (Phase 1: RLS + loud-denial
triggers, ASVS-aligned) and in the pure engine (Phase 2). Threat mitigations are
verified per-phase in `.planning/phases/<phase>/<phase>-SECURITY.md` verdicts.

This file logs **accepted, non-blocking risks** (severity below the `block_on: high`
gate in `.planning/config.json`) with their rationale. Nothing here is an open
vulnerability; each entry was reviewed and consciously accepted.

## Phase 02 — Pure GST Engine (`packages/gst`)

| ID | Severity | Risk | Rationale for acceptance |
|----|----------|------|--------------------------|
| T-2-03 | low | Unbounded BigInt magnitudes from hostile callers could burn CPU (DoS via huge qty/price numerics) | Engine is an in-process library behind an authenticated app; callers are our own clients, not the network. Magnitude caps belong at the app/API boundary (zod schemas, Phase 3+), not in pure math functions where they would duplicate validation. |
| T-2-13 | low | fast-check property runs use large magnitudes that could be slow on constrained dev machines | Dev-only dependency and dev-only runtime; never ships to production bundles. Runtime measured at ~0.6s full suite. |
| T-2-14 | low | `mrp` column (migration 0015) could be probed for existence/timing side-channels | Column is dormant catalog metadata behind Phase 1 RLS; no elevated grants, no definer paths touch it. Risk re-assessed when catalog UI lands (Phase 3). |

Closed findings of note (for the record): CR-01 / WR-01..04 / IN-01..05 fixed in
`2fe724e..12d902b`; T-2-R1 (negative-rate RangeError contract break) fixed in `d344b1e`.

## Phase 05 — Payments & Outstandings

| ID | Severity | Risk | Rationale for acceptance |
|----|----------|------|--------------------------|
| T-05-05 | low | `recorded_by` is caller-supplied through the API; DB does not bind it to the authenticated user | Recorder identity is cosmetic attribution on an append-only row; audit_log (write_audit) remains the trusted attribution path. UI always sends the session profile id. |
| T-05-08 | low | Member-visible payment history within the same business | Payment amounts inside one business are already member-visible via invoice balances (D-41 shared pool); no cross-tenant disclosure. |
| T-05-11 | low | Invoice deep-link (`/bills?invoiceId=...`) reachable by any business member | getInvoice enforces business_id scoping + RLS; deep-link can only surface invoices of the active business. |

Closed in Phase 05 follow-up: T-05-04 (client-writable payment totals on drafts
survived finalize, so a bill could be issued pre-marked "paid" with an empty ledger —
the original acceptance rationale was wrong) closed by migration `0026` (drafts pin
`paid_amount = 0` / `payment_status = 'unpaid'`); pgTAP `draft_payment_totals`.
Migration `0022` is applied to the linked project (T-05-01 production closure
pending only the concurrent-insert verification).

## Audit follow-up (2026-11) — Supabase advisor posture

Migrations `0023`–`0026` are applied to the linked project. Fixed: void/finalize
definer functions callable by any client (F-12), anon-callable RLS helpers and
trigger functions (`0025`). Remaining advisor warnings, reviewed and accepted:

| Advisor finding | Severity | Rationale for acceptance |
|-----------------|----------|--------------------------|
| `authenticated_security_definer_function_executable` (15 RPCs: admin/lifecycle RPCs, `can_access_business`, `current_user_role`, `health_check`) | low | Lifecycle RPCs are the sanctioned API and gate on the server-controlled role inside the function body; the two RLS helpers only answer questions about the caller; `health_check` is the keep-alive target. |
| `anon_security_definer_function_executable` (`health_check`) | low | Intentional anon keep-alive endpoint (D-39); returns a constant. |
| `extension_in_public` (`pgcrypto`) | low | Relocating the extension rewrites every digest/crypt call site (0009/0014); no exposure beyond standard pgcrypto functions. Revisit at productization. |
| `multiple_permissive_policies` (profiles, business_members) | low (performance) | Policy split mirrors the role model and is negligible at this data volume. |
| `auth_otp_long_expiry` | low | Staff invite links must survive a working day; shorter expiry breaks first-login onboarding. |
| `auth_leaked_password_protection` | medium | HaveIBeenPwned check requires the Supabase Pro plan — enable on upgrade (Phase 1 human item). |
