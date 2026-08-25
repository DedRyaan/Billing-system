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
