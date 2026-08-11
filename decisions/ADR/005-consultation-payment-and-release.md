# ADR-005

## Title

Consultation & Appointment Payment, 20% Platform Commission, and Release Workflow

---

## Status

Accepted

---

## Context

CareFind users book consultations and appointments against CareHub businesses (`appointments` table, `source = 'carefind'`). Today a paid booking lands as `payment_status='unpaid'` and is flipped to `'paid'` by `verify-booking-payment.js` once Paystack confirms. The money then sits in the platform's Paystack account with no release or payout mechanism.

Requirements introduced in this session:

1. CareFind users must be able to pay for bookings from their **credits** (CareCoins, integer balance, 1 CareCoin = ₦200).
2. The payment must land in the **business's CareFind account (wallet)** directly.
3. Landing the payment updates **`payment_status` on the CareHub appointment** so the business sees it paid.
4. CareHub-side booking must offer a **payment channel** selector: cash or other channels available on CareHub.
5. The **platform takes 20% of every transaction**.

---

## Decision

### System of record

The workflow is built on the **`appointments`** booking flow (CareHub business ↔ patient), not the CareFind `consultations` table. The `consultations` monetization is an immature stub with no payment plumbing; `appointments` already has `fee_amount` (kobo), `payment_status`, `payment_reference`, `booking_type`, `source`, and a live Paystack verification path.

### Business wallet

Introduce a **`business_wallets`** ledger (one row per `business_id`; balances in kobo, UI displays naira). This is the "CareFind account of the business." Businesses currently have no wallet and no payout rail; this fills both.

### Currency split (20% platform commission)

- Booking fees are naira (kobo on `appointments.fee_amount`).
- A user paying with credits spends `ceil(fee / 200)` CareCoins (integer coins, rounded up).
- The **rounded amount** (`ceil(fee/200) × 200`) is the effective fee for the split: business wallet is credited `80%` of it in naira, platform books the other `20%`. The ≤₦199 rounding overage is absorbed as a rounding adjustment — no coin refunds, no fractional coins.
- Splitting is done in naira so the 20% is exact and CareHub's naira display is unchanged; coin rounding is contained at the point of user spend.

### Platform cut scope

The 20% platform commission applies **only to CareFind-sourced bookings** that the platform processes (CareCoin or online card). CareHub-created walk-in bookings (including cash) are outside the platform's money flow and carry **no platform cut**; they are recorded on the appointment via a payment-channel selector for the business's own books.

### Payment channel on CareHub bookings

CareHub manual bookings get a **payment-channel selector** (cash / other channels available on CareHub). Payment-status tracking for these bookings stays as today's behavior (in-person handling); only the channel is recorded. The selector reuses the POS vocabulary — **Cash, Transfer, POS, Credit** (Split is POS-only) — stored on a new `appointments.payment_channel` column. CareFind-sourced bookings automatically record `carecoins` or `card`.

### Consultation medium

The business sets a default `consultation_medium` + contact (WhatsApp, Zoom, Google Meet, phone) in CareHub settings. It is snapshotted onto each appointment at booking time, and the vendor can override the actual link/ID when confirming. The medium rides along in the patient's confirmation/reminder message. Default guarantees a value exists even if the vendor never overrides.

### Release workflow (soft release)

- Payment lands in the business wallet immediately but is marked **held**.
- When the consultation is marked completed (vendor action in CareHub), the held balance becomes **available** (immediately, via a DB trigger on the status transition).
- A **72-hour dispute window** (`dispute_until`) starts at completion; refunds within/around that window are handled by the `refund_appointment_payment` RPC. The earlier "user acknowledges" step is dropped — no patient portal is built.
- Cancellation refunds the user (coin bookings return the CareCoins spent; card bookings are refunded off-platform by the platform).
- Money moves only via SECURITY DEFINER RPCs on the existing `pay_creator_subscription` / `credit_wallet_topup` atomic pattern — never client-side.

### Payout flow

Mirrors the existing CareFind withdrawal flow (`initiate-withdrawal.js` / `request_withdrawal`): the business owner submits bank details at withdrawal time, a `request_business_withdrawal` RPC (SECURITY DEFINER, service-role) atomically checks the **available** (not held) balance and records the request, and a Paystack transfer fires immediately. No admin approval step — the held→available gate upstream is the only control. Managed from the **CareHub dashboard** (tenant-scoped wallet; appointment lifecycle already lives there).

### Release mechanics

- **Balances are stored in kobo** (integer), matching `appointments.fee_amount`, so the 80/20 split is always exact for CareCoin payments; the UI converts to naira for display.
- **Immediate release on completion**: a DB trigger (`appointments_after_update`) moves the booked 80% from `held_balance` to `available_balance` and stamps `released_at` / `dispute_until = now() + 72h` the moment the vendor marks the appointment `completed`.
- **Platform 20% ledger**: a `platform_transactions` ledger row per paid CareFind booking (`type = 'commission'`, kobo) makes the 20% auditable even though it is inherently retained — the business wallet only ever receives 80%.
- **Coin debit**: a `pay_booking_with_credits` SECURITY DEFINER RPC — atomic and idempotent on the booking's `payment_reference`; deducts `ceil(fee/200)` from the user's wallet, credits the business wallet 80% (held), books the 20% commission — all in one transaction, no partial states. Follows the `credit_wallet_topup` / `pay_creator_subscription` pattern (service-role only, `ON CONFLICT` idempotency). Card payments settle through the equivalent `settle_card_booking` RPC from `verify-booking-payment.js`.
- **Refunds** run through `refund_appointment_payment`, which reverses the ledger credit and returns the user's CareCoins.

---

## Consequences

**Pros**
- Reuses the proven atomic coin-movement RPC pattern and the existing Paystack verification path.
- Naira-denominated business wallet keeps the 20% split exact and CareHub's fee display unchanged.
- Soft release preserves platform control without a patient login/portal.
- Rounding is absorbed into the rounded fee; splits always reconcile against what the platform actually received.
- Payout mirrors the existing in-production CareFind withdrawal flow — no new approval machinery.

**Cons**
- New `business_wallets` + `platform_transactions` tables and a business payout rail add surface area that must be RLS-hardened and reconciled.
- Coin fees that aren't multiples of ₦200 carry a small rounding adjustment for the user (≤₦199).
- The trigger-based release is immediate at completion; the 72h window is enforced at refund time, not by a separate sweep.

---

## Alternatives Considered

1. **CareFind `consultations` table** as the target — rejected: no payment plumbing, would require rebuilding the payment layer from scratch.
2. **Credit the business wallet in CareCoins** — rejected: mixes the 20% split into integer-coin rounding and CareHub displays naira.
3. **Release only on user acknowledgment** — rejected: anonymous patients have no login; replaced by vendor completion + 72h dispute window.
4. **No escrow ("go directly" literally)** — softened to a held → available transition so the platform retains control and cancellation can refund.
