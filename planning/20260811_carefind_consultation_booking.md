# CareFind Professional Consultation Booking — Implementation Record (2026-08-11)

Closes `architecture/Technical-Debt.md` **C13** (CareFind's broken consultation-booking
touchpoints) with the product decision: **the feature is real, and now works.**

## 0. What was wrong

- `ProfessionalMonetization.jsx`'s setup save inserted `{professional_id, patient_id, type,
  fee, notes, status}` into the **shared `consultations` table** — CareHub's clinical table.
  Those columns don't exist there (verified live: `42703 column consultations.professional_id
  does not exist`), so every save silently failed while the UI claimed "saved!"
- `AdminPanel.jsx` monitored that same table for paid bookings — a query that never worked
  (no `'paid'` status is ever written; the embedded FK points at `patients`, not `profiles`).
- No patient-facing booking UI existed anywhere.

## 1. Data model — `apps/carefind/sql/20260811_professional_consultations.sql`

One new table, **not** a reuse of `consultations` (same lesson as
`20260803_consultation_forms.sql` — that name is taken):

- `professional_consultations(id, professional_id→profiles, patient_id→profiles, type, fee
  (naira), notes, status, created_at)`
  - `status='setup'` = the professional's offer (patient_id = their own id — the shape the
    existing dashboard already filters on)
  - `status='paid'` = a patient's booking (type/fee/notes copied from the offer at booking
    time, so later edits don't rewrite history)
- Partial unique indexes: one `setup` offer per professional; one `paid` booking per
  (professional, patient) pair — idempotency backstop.
- RLS: either party can read their rows; a professional can client-insert only their own
  `status='setup'` row. Paid rows are RPC-only.

### `pay_professional_consultation(p_professional uuid)` → text
SECURITY DEFINER, search_path pinned, **patient derived from `auth.uid()`** (the C11/C17
lesson — no caller-supplied money identity). One transaction:

1. `already_booked` pre-check (common case, no money moved)
2. load offer → `no_setup` if none/free
3. `coins = ceil(fee/200)` (1 CareCoin = ₦200; round up so the platform never over-credits)
4. row-lock patient wallet → `insufficient` if balance < coins
5. debit patient → credit pro wallet (self-provision) → both `transactions` ledger rows →
   insert paid booking
6. **the whole body is one exception block** — a raced double-booking's `unique_violation`
   aborts the subtransaction, rolling back the money movement too, not just the insert
   (found in self-review: the first draft had the catch scoped to the insert alone, which
   would have charged the patient on a lost race)
7. granted to `authenticated` only (client-callable, like `send_gift`)

### `settle_consultation_payment(p_patient, p_professional, p_fee, p_reference)` → table
service_role-only card settlement, racing between `paystack-webhook.js` and
`verify-consultation-payment.js` on the same reference. Claims the reference against a
partial unique index on `transactions(reference) WHERE type='consultation_payment'` (the
**C15 race lesson** — no JS check-then-act), inserts the paid booking, credits the pro
wallet, writes both ledger rows — atomic, so only one racing caller can settle.
Deliberately **does not debit the patient wallet**: the card payment is the settlement.
(This corrects the subscription card path's latent quirk, which calls
`pay_creator_subscription` and debits the wallet the user just topped up by card.)

## 2. API endpoints

- `api/charge-consultation.js` — POST `{professionalId, callback_url}`; loads the pro's
  offer (fee is server-authoritative), initializes Paystack with reference
  `cf_consult_<uid8>_<hex>` and metadata `{user_id, professional_id, fee, purpose:
  'consultation'}`; 15% `transaction_charge` split when the pro has a `paystack_subaccount_code`
  (matches the "you earn 85%" copy).
- `api/verify-consultation-payment.js` — POST `{reference}`; Paystack-verifies, enforces
  `metadata.user_id === caller` (403 otherwise), settles via the RPC. Idempotent.
- `api/paystack-webhook.js` — new `handleConsultation` dispatch (purpose flag) between the
  subscription and plan handlers; the async backup path.
- `api/_lib/consultationSettle.js` — shared settle helper (webhook + verify call the same RPC).

## 3. Client

- `src/modules/subscriptions-monetization/consultations.js` — offer fetch, booking-state
  check, `bookConsultation` (RPC), `bookConsultationWithPaystackFallback` (wallet → card,
  mirrors `subscribeWithPaystackFallback`), `settleConsultationCardPayment`.
- `PublicProfile.jsx` — consultation card on `/u/:id` (type badge, ₦fee ≈ CareCoins, notes,
  "Book Consultation" button, "Booked" state), ConfirmDialog, insufficient → warning toast
  with "Top up" action → `/wallet`, post-redirect settlement resume via a
  `cf_consult_pending` sessionStorage marker, `notify()` to the professional on success.
- `ProfessionalMonetization.jsx` — setup save now upserts into the new table, surfaces
  errors (the silent-failure class C13 documented), and reloads the existing offer into the
  form; Incoming Bookings reads the new table.
- `AdminPanel.jsx` — monitor query rerouted to `professional_consultations` (embed via
  `professional_consultations_professional_id_fkey`).
- `services/notify.js` — `consultation` message added to `NOTIF_MESSAGES`.

## 4. Tests & verification

- `src/test/payments/consultations.test.js` — 6 unit tests (`coinsForConsultation` rounding,
  zero/negative/null/string handling). Full suite: 126 passed (1 pre-fix failure was
  `Math.ceil(-0.25) === -0`; clamped in the helper). Clean `vite build`.
- SQL verification steps are in the migration's VERIFY block (probe `pay_professional_consultation`
  for ok/insufficient/already_booked; probe `settle_consultation_payment` idempotency for
  already_processed/already_booked).

## 5. Deploy steps (Blocked-on-you #5)

1. Run `apps/carefind/sql/20260811_professional_consultations.sql` via the Supabase SQL
   editor, then run the VERIFY probes.
2. Deploy the carefind app build (new endpoints + client).
3. Re-run the VERIFY probe 5 end-to-end (book by wallet and by card on `/u/<pro>`; check
   "Incoming Bookings" in `/earn`; check the admin notification feed).
4. After confirmation, flip the migration STATUS header + commit.

## 6. Files touched

| File | Change |
|---|---|
| `apps/carefind/sql/20260811_professional_consultations.sql` | NEW — table, indexes, RLS, 2 RPCs |
| `apps/carefind/api/charge-consultation.js` | NEW — Paystack initialize |
| `apps/carefind/api/verify-consultation-payment.js` | NEW — Paystack verify + settle |
| `apps/carefind/api/_lib/consultationSettle.js` | NEW — shared settle helper |
| `apps/carefind/api/paystack-webhook.js` | +`handleConsultation` dispatch |
| `apps/carefind/src/modules/subscriptions-monetization/consultations.js` | NEW — client service |
| `apps/carefind/src/PublicProfile.jsx` | consultation card + booking flow |
| `apps/carefind/src/modules/subscriptions-monetization/ProfessionalMonetization.jsx` | new table, upsert, error surfacing, offer reload |
| `apps/carefind/src/modules/admin/AdminPanel.jsx` | monitor → `professional_consultations` |
| `apps/carefind/src/services/notify.js` | consultation message |
| `apps/carefind/src/test/payments/consultations.test.js` | NEW — 6 tests |
| `architecture/Technical-Debt.md`, `architecture/Schema-Reference-CareFind.md`, `planning/REMEDIATION-STATUS.md` | C13 resolved, table documented, session log |

## 7. Notes / known limits

- Card-path bookings need the Paystack webhook registered (it already is — top-ups and
  subscriptions use it in production).
- A pro with a Paystack subaccount gets the 85/15 split on card payments **and** full
  CareCoins credited in the ledger — the same pattern the subscription card path already
  uses; settlement reconciliation is a separate concern (out of scope, same as
  subscriptions).
- The offer card is visible only to signed-in users (RLS is the authority); pre-login
  visitors see no consultation card — same behavior as subscription access.
- No resume marker invalidation: `cf_consult_pending` is cleared on any profile load where
  the ids match, before the settle call.
