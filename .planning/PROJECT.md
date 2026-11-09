# GST Billing System

## What This Is

A cloud-synced GST-compliant billing management and creation system for a business owner running multiple businesses. Desktop-first native apps with a mobile companion, designed with a minimalist Apple-native aesthetic. Admins manage businesses, users, and records; staff users create bills and estimates for their assigned businesses from anywhere.

## Core Value

The owner can run all their businesses' billing entirely from this app daily — GST-correct invoices go out in seconds, and money owed is always visible.

## Business Context

- **Customer**: Self (own businesses) today; external client businesses planned later with modifications
- **Revenue model**: None yet — personal tool first, potential productization after
- **Success metric**: Daily active use across own businesses six months in
- **Strategy notes**: Architect data isolation so multi-business today maps cleanly to multi-tenant SaaS later

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Multi-business support — each business has isolated customers, catalog, invoices
- [ ] Admin can add/modify business details (GSTIN, address, state, contact)
- [ ] Admin can manage user accounts and assign staff to businesses
- [ ] Staff can create bills/estimates only for their assigned businesses
- [ ] Staff issue bills freely without approval gate; admin reviews after the fact
- [ ] GST-compliant tax invoices: GSTIN fields, CGST/SGST vs IGST breakup by place of supply, HSN/SAC codes
- [ ] Automated sequential invoice numbering per business per financial year
- [ ] Estimates that convert to invoices on acceptance
- [ ] Full payment tracking: partial payments, payment history per invoice, outstanding aging
- [ ] Product/service catalog with stock quantity tracking, plus ad-hoc custom-priced line items
- [ ] Customer database per business, reusable across bills
- [ ] PDF export and WhatsApp sharing of bills
- [ ] Dashboard: outstandings, monthly revenue per business at a glance
- [ ] Audit trail: who created/edited/deleted what
- [ ] GSTR-1 style export summaries for filing support
- [ ] Cloud-synced data usable from desktop app and mobile companion

### Out of Scope

- E-invoicing / IRN API integration — mandatory only above ₹5Cr turnover; adds third-party GSP dependency. Revisit in v2.
- Credit/debit notes — v2; corrections in v1 handled by void-and-reissue (editing issued invoices is not GST-compliant)
- Recurring invoices — v2
- Expense tracking — v2; billing is the core loop first
- Customer-facing portal — future; WhatsApp/PDF covers delivery now
- Purchase orders / procurement — inventory decrements only in v1
- Multi-currency / non-GST tax regimes — INR + Indian GST only

## Context

- Replaces nothing formal — no structured billing process exists today; Excel/manual docs at most
- Small scale: ~2–3 businesses, 2–5 staff, tens of bills per month
- Team is trusted: free issuance chosen over approval workflow
- Owner values "dynamic and easy to use" — speed of bill creation is a design driver
- UI must feel like an Apple native app: minimalist, uncluttered, native-feeling
- Must be a proper installed app experience, not a browser tab — desktop primary, mobile companion for quick views/approvals on the go
- Data lives in cloud sync since staff work from different locations

## Constraints

- **Tech stack**: Native-feeling desktop + mobile apps with a cloud backend — exact stack pending research
- **Compliance**: Indian GST rules — CGST/SGST/IGST by place of supply, invoice numbering series per FY, GSTR-1 export format
- **Design**: Apple-minimalist visual language throughout
- **Architecture**: Per-business data isolation now; must not block multi-tenant productization later
- **Platform**: Windows desktop confirmed in use; cross-platform desktop preferred but secondary to Windows

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cloud-synced architecture over local-only | Staff create bills from anywhere; owner sees everything live | — Pending |
| Desktop-first with mobile companion | Billing work happens on PC; phone for quick views/approvals | — Pending |
| Compliant invoices + GSTR-1 export in v1, IRN e-invoicing deferred | IRN only mandatory >₹5Cr turnover; avoids GSP dependency in v1 | — Pending |
| Free issuance, no approval gate | Small trusted team; admin reviews after the fact | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-23 after initialization*
