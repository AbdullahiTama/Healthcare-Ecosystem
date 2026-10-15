# ADR Privacy, Security & Auditability (Phase 9)

## What changed

No features. This phase proved the running system enforces its own rules and
closed the gaps the probes found.

- `supabase/migrations/carehub_20261110_adr_delete_guards.sql`
  (mirror: `apps/carehub/sql/20261110_adr_delete_guards.sql`), APPLIED live:
  non-admin hard delete blocked for non-draft reports, children of non-draft
  reports, and verified/routed routes; submit RPCs restricted to
  authenticated-only EXECUTE; deadline-rule changes audited to
  `admin_audit_log` with actor + before/after.
- `supabase/migrations/carehub_20261109_adr_trigger_execute_hardening.sql`
  (+ mirror), APPLIED live: anon EXECUTE revoked on all trigger functions
  (plus the two pre-existing ADR ones for consistency).
- All 8 ADR architecture notes moved from REVIEW ONLY to APPLIED-live status.

## Live adversarial evidence (2026-10-15, production)

- EXECUTE grants on all ADR functions: postgres + authenticated + service_role
  only — anon holds nothing.
- Anon probes: reports/routes/events return 42501 (helper EXECUTE denial);
  masked view denies; search RPC denies; submit RPC denies via RLS helper;
  aliases return 0 rows. No anonymous path reaches case data.
- search_path audit: zero ADR functions with mutable search_path.
- Transactional delete probes (rolled back, zero residue, counts 36/2
  confirmed after): draft delete allowed; submitted delete raises the guard
  message; child delete on submitted raises the guard message.
- Calculator proven live: active rule `brief-2026-10-unverified`,
  serious+unexpected Jan 1 → Jan 4 (+72h), non-serious+expected → Apr 1 (+90d).
- Security models confirmed live: `submit_adr_report` INVOKER, all others DEFINER.
- Advisors: one new ERROR is intentional and documented — the masked case view
  is owner-executed by design (column masking is impossible otherwise; access
  predicate + authenticated-only grant are the controls). Trigger-function
  anon-EXECUTE WARNs closed by the hardening migration. All other findings
  pre-date this work.

## Pre-existing production truth discovered

- `text[] || scalar` fails on PG17: the August submit gate 500'd on invalid
  input instead of returning structured errors (valid submits always worked).
  The Phase 3 core uses `array_append`; live gate now returns structured
  `missing` + `missingFields` on real data, including the business-contact
  fallback firing correctly.
- Live data: 35 drafts + 1 follow_up_required, 0 submitted, 0 routes.
  businesses.email is NOT NULL, so the Hub contact fallback effectively always
  has facility contact — documented, acceptable per Ruling 1.

## Standing decisions and deferrals

- Reporter masking stays interim until the privacy lead rules (widening needs
  sign-off); initials-vs-full-name unresolved — UI steers to minimization.
- Encryption at rest is platform-provided; no column-level encryption (noted,
  not implemented).
- Notifications (routing/follow-up emails) are designed-not-wired: events
  provide the hooks; templates + recipient policy need comms/privacy sign-off.
- Staging RLS-as-app-user matrix and the CareFind component suite stay CI-bound;
  no test users were minted in production.
- Other agents are active in this checkout (unrelated withdrawals work in the
  tree); all ADR commits used explicit pathspecs and contain only ADR files.

## Status: migrations APPLIED live 2026-10-15 and verified (see per-phase notes)
