# ADR-003

## Title

Shared Clients with Global Debts

---

## Status

Accepted

---

## Context

In the branch-as-business model, each branch owns its own `clients` rows (scoped by `business_id`). But a patient who visits the Lagos branch today may visit the Abuja branch next month — they are the same person and should be recognised as such. Debts raised at any branch follow the patient, not the branch.

---

## Decision

Add `global_client_id` to `clients` — a self-referential link pointing at the canonical record for that person. A `client_visits` table records every interaction (sale, appointment, consultation) tagged with the branch it happened at.

- **Owner view**: unified client list with full cross-branch visit history.
- **Branch staff view**: their own visits plus a flag showing the patient also visits other branches.
- **Debts**: global to the client — any branch sees the total outstanding; any payment reduces it everywhere.

When a branch creates a client, the system matches on phone/email to link to an existing global record, or creates a new one.

---

## Consequences

**Pros**
- Patient identity is consistent across branches — no duplicate records, no "who owes what" confusion.
- Credit risk is visible globally — if a client defaults at Lagos, Abuja sees it before extending more credit.
- Visit history is per-branch but aggregated for the owner.

**Cons**
- Client creation now requires a match step (phone/email lookup) — edge cases (same person, different phone numbers) need manual review.
- `client_visits` is a new write path that must be populated by every sale/appointment/consultation action — it is eventually consistent, not transactional with the source.

---

## Alternatives Considered

1. **Per-branch clients only** — no sharing. Rejected — duplicates the patient record at every branch and hides cross-branch credit risk.

2. **Fully shared client table** — one `clients` table with a `branch_id` on each visit. Rejected — mixes tenant data, breaks the per-branch scoping that every other table uses, and complicates RLS.
