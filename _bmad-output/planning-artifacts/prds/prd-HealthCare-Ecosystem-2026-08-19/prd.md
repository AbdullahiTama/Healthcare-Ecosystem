---
title: CareHub Premium Value Upgrade
status: final
created: 2026-08-19
updated: 2026-08-19
---

# PRD: CareHub Premium Value Upgrade
*Working title — confirm.*

## 0. Document Purpose

This PRD defines the premium value upgrade for CareHub, the healthcare OS for Nigerian pharmacies, hospitals, labs, and imaging centers. It is for the PM, engineering leads, and downstream workflow owners (UX, architecture, epics/stories). It builds on the brainstorming session recorded in `_bmad-output/brainstorming/brainstorm-carehub-premium-upgrade-2026-08-19/.memlog.md` and the distilled intent in `brainstorm-intent.md`; it does not duplicate them. Vocabulary is Glossary-anchored (§3), features are grouped with globally numbered Functional Requirements (§4), and every inferred decision is tagged `[ASSUMPTION]` and indexed (§9).

The full upgrade is scoped here; the MVP boundary is deliberately strict — the P0 unlock only (§6) — so a buildable slice lands before the long tail.

## 1. Vision

CareHub already runs the daily operations of Nigerian health businesses — POS, batch-and-expiry inventory, purchases, stock, debts, appointments, consultations, and a public discovery layer in CareFind. Cheap competitors in the ₦8k–₦80k NGN/month band offer receipt-printing and stock counts. CareHub's premium tier must win the operator who loses money to expired drugs, trusts no cashier, chases debtors by hand, and dreads regulatory inspection.

This upgrade turns CareHub into the trust-and-growth operating system for that operator. It stops revenue bleeding at the point of sale (never sell an expired batch), proves compliance to NAFDAC/PCN with one click, recovers cash that today evaporates into uncollected claims and debts, and turns CareFind traffic into booked, prepaid patients. The highest-value capabilities cluster into four pillars — Trust & Compliance, Cash Recovery, Growth & Network, Clinical Depth — supported by quick wins that raise perceived value while the pillars ship.

Premium value is why a growth-tier pharmacy at ₦25k/month and a hospital at ₦35k/month stay, upgrade, and tell other owners. The unlock order is deliberate and applies across the roadmap: FEFO + expired-batch block first (the expiry data is already being captured at purchase), then the HMO/NHIS claims engine, then the owner digest. The MVP ships only the first unlock; the claims engine and owner digest follow as v1.1 items in that order.

## 2. Target User

### 2.1 Jobs To Be Done

- "I want to know my business actually made a profit today." — a daily, plain-language P&L per location.
- "I want to stop losing money to expired and stolen stock." — variance reports, FEFO, expiry alerts.
- "I want to get paid what my patients' HMOs owe me." — claims capture, submission, and tracking.
- "I want to stop chasing debtors." — automated reminders, payment links, credit scoring.
- "I want to pass a NAFDAC/PCN inspection without panic." — one-click compliance bundles, controlled-drug registers.
- "I want my branches to behave like one business." — central inventory, transfers, consolidated reporting.
- "I want to trust my staff." — granular roles, audit logs, shift reconciliation.
- "I want more patients, not just smoother ops." — CareFind as a lead engine, booking, prepay, e-commerce.
- "I want to look modern and be in control from my phone." — owner digest, anomaly alerts, voice briefing.

### 2.2 Non-Users (v1)

- Single-desk retailers outside healthcare (general stores, boutiques) — horizontal POS is not a target.
- Non-Nigerian first markets — localization for GH/KE/ZA is v3+ `[ASSUMPTION]`.
- Regulated insurance payers — CareHub submits claims, it does not adjudicate them.

### 2.3 Key User Journeys

- **UJ-1. Pharmacist refuses to sell an expired batch.**
  - **Persona + context:** Ada, head pharmacist at a growth-tier pharmacy, is serving a customer on a busy Saturday.
  - **Entry state:** authenticated cashier session at POS.
  - **Path:** scans a product that has stock only in an expired batch → POS blocks the line → toast shows "Batch EXP-2301 expired 2026-07-14 — cannot sell" → Ada taps "view alternative batches" → another batch exists → sale proceeds.
  - **Climax:** the sale completes from the valid batch and the system records the FEFO decision automatically.
  - **Resolution:** Ada is confident she did not dispense expired medicine; the audit log records everything.
  - **Edge case:** a licensed override exists for approved exemptions; every override is logged and requires a documented reason.

- **UJ-2. Owner wakes up to what needs attention.**
  - **Persona + context:** Tunde, owner of three branches, opens his phone before the market opens.
  - **Entry state:** not authenticated; receives the daily digest via WhatsApp/email.
  - **Path:** digest lists — "3 items expiring in 7 days (loss ₦41,200)", "5 invoices overdue", "2 HMO claims awaiting decision" → he taps through to the dashboard's attention list.
  - **Climax:** he marks two items for markdown from his phone; the approval reaches the branch.
  - **Resolution:** decisions are taken in 90 seconds without opening the full dashboard.
  - **Edge case:** no items to surface — the digest shows a single "all clear" line and the day's headline numbers.

- **UJ-3. Practice manager files an HMO claim without paperwork.**
  - **Persona + context:** Ngozi, practice manager at a hospital running CareHub, holds a stack of insured consultations.
  - **Entry state:** authenticated manager session.
  - **Path:** at sale she captures scheme + policy number (autocompleted from patient profile) → claim auto-created → submits a batch of claims to the payer → status shows Submitted.
  - **Climax:** weeks later the digest shows "Claim CH-8821 approved, ₦185,000 reimbursed."
  - **Resolution:** cash flows back without phone calls or spreadsheets.
  - **Edge case:** a claim is denied — the system shows the denial reason and re-submission workflow.

## 3. Glossary

- **Batch** — a stock lot with a unique identifier and an Expiry Date; the unit of expiry control. (Purchases already capture `expiry`/`batch`.)
- **Expiry Date** — the date a Batch must not be sold after.
- **Expired Batch** — a Batch whose Expiry Date is before the current date.
- **FEFO** — First-Expiry-First-Out: the rule that stock from the Batch with the nearest Expiry Date is picked first at the POS.
- **Expired-Batch Block** — the POS control that refuses a sale line referencing an Expired Batch.
- **Licensed Override** — a permission-gated action allowing a sale from an Expired Batch, always audited with a reason.
- **Claim** — a request for reimbursement of an insured service/sale submitted to a payer under an HMO/NHIS scheme.
- **Payer** — the HMO/NHIS scheme that reimburses Claims.
- **Owner Digest** — the scheduled plain-language daily brief to an owner covering P&L, attention items, and alerts.
- **Attention Item** — a dashboard/digest entry requiring a decision (expiring stock, overdue debts, unpaid invoices, denied claims).
- **GRN** — Goods Received Note, the record that a purchase order's goods arrived.
- **Variance** — the difference between theoretical stock and counted/sold stock.
- **CareFind** — CareHub's public discovery platform; inbound lead source for businesses.
- **Scheme** — an HMO/NHIS insurance plan a patient is enrolled in.
- **FEFO decision** — the system's automatic selection of the nearest-expiry Batch for a sale line.
- **Compliance Bundle** — the one-click export of regulatory documents (NAFDAC/PCN/tax) for inspection.
- **Controlled-Drugs Register** — the legally required log of Schedule I–IV substances dispensed.
- **Unit of Measure (UoM)** — how a product is stocked (box/pack) vs sold (tablet/unit); auto-conversion applies.
- **Payer Reimbursement** — funds received from a Payer for an approved Claim.

## 4. Features

### 4.1 Expiry Safety (Trust & Compliance)

**Description:** The expiry lifecycle becomes a closed loop from purchase to POS. FEFO selects the nearest-expiry Batch at the point of sale; an Expired Batch can never be sold without a Licensed Override that is always audited. An expiry alert dashboard makes the forward risk visible per warehouse and in money terms, and dead stock gets automated markdown suggestions instead of quietly going bad. Realizes UJ-1. This is the P0 unlock.

**Dependency note (critical):** today a sale decrements `products.stock` via the `sale_stock_movement` trigger (applied 2026-08-04), but never attributes the line to a Batch — `sales.items` carries product ids only, and `stock_batches` quantity is not consumed on sale. FR-1/FR-2 therefore require a **Batch attribution layer**: a sale line must carry the Batch it draws from, and a Batch's available quantity must decrement atomically with the sale. This is a schema + POS flow change, not a reporting feature.

**Functional Requirements:**

#### FR-1: FEFO batch selection at POS

[A Cashier] at the POS can select a product, and the system automatically proposes the Batch with the nearest future Expiry Date for that sale line, where stock quantity permits. Realizes UJ-1.

**Consequences (testable):**
- When two or more non-expired Batches of a product have stock, the system defaults to the Batch with the earliest Expiry Date.
- A Cashier may choose a different non-expired Batch, and the choice is logged.
- FEFO applies per sale line, across warehouses via the active warehouse scope.
- A sale line that references a Batch records that attribution; the Batch's available quantity decrements atomically with the sale (via the batch-attribution layer).

**Out of Scope:**
- FEFO for physical picking in a walk-in store (label printing is deferred to FR-16).

#### FR-2: Expired-Batch Block

[A Cashier] cannot complete a sale line whose only stock reference is an Expired Batch. Realizes UJ-1.

**Consequences (testable):**
- Attempting to add an Expired Batch to a sale is refused with a clear inline message naming the Batch and its Expiry Date.
- A User with the Licensed Override permission can release the block; every override records actor, reason, Batch, and timestamp.
- Overrides are visible in the audit trail and excluded from compliance exports by default.

#### FR-3: Expiry alert dashboard

[An Owner or Manager] can view a dashboard of Batches expiring within 30/15/7/0 days, per warehouse, with the expected loss value of each. Realizes UJ-2.

**Consequences (testable):**
- The dashboard supports horizon filters (30/15/7/0 days) and per-warehouse scoping.
- Each row shows Batch, product, quantity, Expiry Date, and quantity × unit cost as expected loss.
- The dashboard is the data source for the Owner Digest attention list.

#### FR-4: Dead-stock markdown suggestions

[An Owner or Manager] can review generated markdown/promotion suggestions for stock expiring within the configured horizon (bundle, discount, donation write-off) and approve or dismiss each. Realizes UJ-2.

**Consequences (testable):**
- Suggestions are generated only for Batches with quantity above a configurable minimum and within the horizon.
- Approving a suggestion creates a price change or markdown record applied at the POS.
- Dismissed suggestions do not recur within the same cycle.

#### FR-5: Expiry variance reporting

[An Owner] can compare theoretical stock (what the system says should remain) against expected expiry consumption and counted stock, surfacing unexplained loss. Realizes JTBD "stop losing money."

**Consequences (testable):**
- The variance report reconciles purchases, sales, transfers, and expiry write-offs per Batch.
- Unexplained differences are highlighted and link to the audit trail.

**Feature-specific NFRs:**
- Expiry computations must be timezone-safe (business-local date, not UTC drift).

**Notes:**
- `[NOTE FOR PM]` The live `products.expiry_date` column exists but is not synced from `stock_batches`; a backfill/trigger is deferred work — confirm before FR-3 analytics depend on it.

### 4.2 Compliance Bundle (Trust & Compliance)

**Description:** One-click regulatory readiness. A Compliance Bundle exports controlled-drug registers, narcotic logs, and tax/VAT summaries in an inspector-friendly format, backed by a signed, tamper-evident audit trail. This is the emotional win for the regulated owner.

**Functional Requirements:**

#### FR-6: Controlled-Drugs Register

[An Owner or licensed pharmacist] can generate a Controlled-Drugs Register (Schedule I–IV) covering acquisitions, dispensing, and stock for the period. 

**Consequences (testable):**
- The register includes acquisition, dispense, and closing stock per controlled substance with timestamps.
- Export formats include PDF and CSV, suitable for inspector review.

#### FR-7: One-click compliance bundle export

[An Owner] can generate a Compliance Bundle covering NAFDAC, PCN, tax, and VAT summaries for a date range in one action.

**Consequences (testable):**
- The bundle contains the controlled-drugs register, narcotic log, purchase/sales summaries, and tax/VAT breakdown.
- The export carries a generated manifest listing included documents and the export timestamp.

#### FR-8: Signed audit trail export

[An Owner] can export an audit trail of privileged actions (overrides, price changes, role changes, voided sales) with integrity markers.

**Consequences (testable):**
- Every listed event records actor, action, object, before/after state, and timestamp.
- The export includes a signature/checksum so tampering is detectable.
- Excludes patient-identifiable data unless the exporting User holds the appropriate role `[ASSUMPTION]`.

#### FR-9: NAFDAC recall alert feed

[An Owner] receives alerts when a product in their inventory appears in an ingested NAFDAC drug-recall notice, with affected Batches highlighted.

**Consequences (testable):**
- The feed ingests recall notices and matches against catalog + Batch data.
- `[ASSUMPTION]` Ingestion source is a curated NAFDAC recall feed (manual CSV entry or a maintained public list) — no formal API confirmed yet; ingestion adapter is pluggable.
- A recalled Batch is flagged and can be quarantine-marked, removing it from FEFO selection and POS sale.
- Alert delivery honors the Owner Digest channel (WhatsApp/email) `[ASSUMPTION]`.

### 4.3 HMO/NHIS Claims Engine (Cash Recovery)

**Description:** Insured revenue stops leaking. Scheme and policy are captured at the point of sale (autocompleted from the patient profile), a Claim is created automatically, submission happens in batch to the Payer, and reimbursement status flows back into cash reporting. Realizes UJ-3. This is the second unlock.

**Functional Requirements:**

#### FR-10: Scheme and policy capture at sale

[A Cashier] can attach a Scheme and policy number to a sale line or invoice for an insured patient.

**Consequences (testable):**
- Policy number autocompletes from the patient profile; manual entry is allowed with validation.
- Each covered line is tagged with payer, policy, and coverage rule.
- Non-covered lines are billed to the patient normally.

#### FR-11: Claim creation and submission

[An Owner/Manager] can review auto-created Claims and submit them in batch to a Payer.

**Consequences (testable):**
- A Claim is auto-created per invoice with covered lines and the attached policy.
- Batch submission supports a per-Payer template and produces a submission manifest.
- Submission status persists (Draft / Submitted / Under Review / Approved / Denied / Reimbursed).

#### FR-12: Claim status tracking and reimbursement

[An Owner/Manager] can track Claim status and reconcile approved Claims against received payments.

**Consequences (testable):**
- Status changes are recorded with dates; the Owner Digest surfaces Claims awaiting decision.
- A Denied Claim shows the denial reason and supports re-submission.
- Reimbursed amounts reconcile to revenue reporting and outstanding-Claim totals.

#### FR-13: Claims aging report

[An Owner] can view outstanding Claims by Payer and age bucket to chase slow payers.

**Consequences (testable):**
- Report groups Claims by Payer and age (0-30/31-60/61+ days).
- Total outstanding value per Payer is computed from approved-but-unreimbursed Claims.

**Feature-specific NFRs:**
- `[ASSUMPTION]` The engine targets common Nigerian HMO/NHIS schemes (Hygeia, Avon, Reliance, NHIA); export templates are Payer-specific and configurable.

### 4.4 Debt Recovery (Cash Recovery)

**Description:** Chasing debtors is automated and polite. Debt reminders go out over WhatsApp/email/SMS with a Paystack collection link, debtor credit scoring prioritizes follow-up, and cash integrity is tightened with shift reconciliation and variance controls.

**Functional Requirements:**

#### FR-14: Automated debt dunning

[An Owner] can schedule reminder runs for overdue debts with configurable channels (WhatsApp/email/SMS) and cadence.

**Consequences (testable):**
- Reminders include the outstanding amount, due date, and a payment link that records inbound payments.
- Reminder history per debtor is recorded and suppressible per debtor.
- Cost per message is metered `[ASSUMPTION]`.

#### FR-15: Debtor credit scoring

[An Owner] can view a credit score per debtor that prioritizes follow-up, derived from history, aging, and recovery.

**Consequences (testable):**
- Score inputs: payment history, outstanding balance, average delay, write-offs.
- The score is a single surfaced number with the underlying factors listed.

#### FR-16: Shift reconciliation and cash integrity

[An Owner] can reconcile each Cashier shift — expected cash from sales and payments vs counted cash — and flag variance.

**Consequences (testable):**
- Shift open/close captures starting float and counted cash.
- Variance is computed against sales, refunds, and payouts; positive/negative variance flags the shift.
- Granular role permissions gate access to reconciliation and void actions.

### 4.5 Growth & Network

**Description:** CareFind stops being a directory and becomes a lead engine: search → book → prepay → visit. Loyalty and referral mechanics keep patients returning, an e-commerce storefront extends reach, and the network monetizes referrals.

**Functional Requirements:**

#### FR-17: CareFind booking with prepay

[A Patient] can search, choose a CareHub business, book a service, and prepay via Paystack, receiving a queue number.

**Consequences (testable):**
- Booking flows into the business's appointment system with payment status attached.
- Prepaid visits appear in the business's incoming-visits queue with a queue number.
- Payment failures do not create confirmed bookings.

#### FR-18: Loyalty points at POS

[A Cashier] can award and redeem loyalty points on a patient's payment, configurable per business.

**Consequences (testable):**
- Points accrue on eligible payments and are redeemable at the POS against purchases.
- Redemption history is auditable and can be voided by a Manager.

#### FR-19: Shopper storefront

[A Business] can publish a shoppable online storefront (catalog subset, local pricing) with delivery management for orders.

**Consequences (testable):**
- Storefront products come from the business's catalog with explicit publish toggles.
- Orders enter the business's sales pipeline with fulfillment status; delivery assignment is tracked.
- `[ASSUMPTION]` Delivery management is in-house (no third-party courier integration in v1).

#### FR-20: Referral network monetization

[A Business] can configure referral revenue-share rules on the existing referral-agent flow, including inter-pharmacy prescription referrals.

**Consequences (testable):**
- Referral commission rates are configurable per source/type.
- Commissions accrue on completed referred transactions and appear in reports.
- Referral bonuses can be redeemed against a debtor's own balance.

### 4.6 Clinical Depth

**Description:** CareHub becomes the longitudinal record, not a transaction log. E-prescriptions carry a QR the patient scans at any CareHub pharmacy, lab results push to the patient's phone, the patient timeline unifies care across modules, and an inpatient module wins hospital customers.

**Functional Requirements:**

#### FR-21: E-prescription with QR

[A Clinician] can issue an e-prescription with a QR code a patient can scan at any CareHub pharmacy.

**Consequences (testable):**
- The QR encodes a verifiable prescription reference; scanning opens the prescription in the pharmacy POS context.
- Dispensing against the QR links the sale to the prescription; partial dispensing is supported.
- Printable prescription output exists for patients without smartphones `[ASSUMPTION]`.

#### FR-22: Lab results push

[A Patient] receives lab results via WhatsApp/email with PDF and an optional clinician explanation.

**Consequences (testable):**
- Results publish to the patient's timeline and are push-delivered on publication.
- Access requires consent or a secure link `[ASSUMPTION]`.
- Sending is metered per result `[ASSUMPTION]`.

#### FR-23: Unified patient timeline

[A Clinician] can view a single patient timeline spanning pharmacy, hospital, lab, and imaging events.

**Consequences (testable):**
- Timeline events are ordered chronologically and filterable by module.
- Consent-based health profile data (allergies, blood group, chronic conditions) is editable by a Clinician with the patient's consent.

#### FR-24: Inpatient module

[A Hospital staff] can manage admissions, beds/wards, nursing tasks, and discharge for inpatients.

**Consequences (testable):**
- Admission creates a patient stay with bed/ward assignment and attending staff.
- Nursing tasks are assignable with status tracking.
- Discharge closes the stay, finalizes billing, and posts the stay to the patient timeline.

#### FR-25: Clinical decision support

[A Pharmacist/Clinician] sees drug-interaction, contraindication, and dosage warnings drawn from an enriched catalog (therapeutic classes, generics).

**Consequences (testable):**
- Warnings appear at prescription/dispensing entry where the catalog carries interaction data.
- Warnings are advisory; dispensing is never hard-blocked by CDS alone.
- `[NOTE FOR PM]` Interaction data sourcing and medical-accuracy liability need review before launch.

### 4.7 Owner Insight (Owner Digest + AI) (Cross-cutting)

**Description:** The operator gets answers, not charts. A daily plain-language digest covers P&L and attention items; anomaly alerts surface problems proactively; an AI assistant answers business questions and drafts routine work. This is the third unlock.

**Functional Requirements:**

#### FR-26: Daily Owner Digest

[An Owner] receives a scheduled plain-language daily brief (P&L per location, attention items, alerts) via email/WhatsApp.

**Consequences (testable):**
- Digest content is generated from the prior day's closed data and delivered on schedule.
- Delivery channel and time are configurable; per-location and consolidated views exist.
- The digest links each attention item into the dashboard.

#### FR-27: Anomaly alerts

[An Owner] receives proactive alerts when configured metrics deviate from baselines (e.g., sales vs same hour last week, unusual discounting, low stock).

**Consequences (testable):**
- Alerts are threshold/baseline-driven and channeled through the digest channels.
- Alert rules are configurable and suppressible.

#### FR-28: AI back-office assistant

[An Owner/Manager] can ask plain-language questions about the business ("How is my pharmacy doing?") and receive grounded answers, and can draft routine documents (POs, reminders) from prompts.

**Consequences (testable):**
- Answers are grounded in the business's own data; sources are cited.
- Generated drafts require explicit owner confirmation before execution.
- `[NOTE FOR PM]` Scope AI to low-risk read/query + draft functions for MVP; autonomous actions are v3.

**Cross-cutting NFRs (all features):**
- **Performance:** POS line-add with FEFO resolution must add <150ms p95 to checkout on the FEFO path, measured over a 100k-line catalog, under normal connectivity. Batch attribution must not change the sale write path's latency class (single round-trip preserved).
- **Security:** All privileged actions (overrides, voids, role changes, reconciliation) are audited; RLS remains the enforcement boundary.
- **Reliability:** Core POS flows must degrade gracefully offline and sync on reconnect (existing offline queue extended to carry batch attribution on replayed sales).
- **Observability:** New engine actions (claims, digest, alerts) emit structured logs.

**Constraints and Guardrails:**
- **Safety:** An Expired Batch is never sellable without an audited Licensed Override. FEFO/block logic must never weaken this.
- **Privacy:** Patient-identifiable data (health profiles, results) requires consent and is excluded from compliance exports by default.
- **Cost:** WhatsApp/email/SMS delivery is metered; the digest must not exceed a configurable per-business budget `[ASSUMPTION]`.

## 5. Non-Goals (Explicit)

- We are **not** building an adjudication engine for insurers — CareHub submits and tracks Claims, payers decide.
- We are **not** building a general-purpose horizontal POS for non-healthcare retail.
- We are **not** building native mobile apps in v1; web/PWA-first, Android apps are v2+ `[ASSUMPTION]`.
- We are **not** expanding beyond Nigeria in v1; GH/KE/ZA localization is v3+.
- We are **not** implementing RFID/loT cold-chain monitoring in v1; it is a moonshot.
- We are **not** building third-party courier integration in v1; delivery is in-house.
- We are **not** making AI take autonomous business actions in MVP; the assistant confirms before executing.

## 6. MVP Scope

### 6.1 In Scope (v1 — the P0 unlock)

- FR-1 FEFO batch selection at POS (with the Batch attribution layer: sale lines carry Batch, Batch quantity decrements atomically).
- FR-2 Expired-Batch Block with Licensed Override + audit.
- FR-3 Expiry alert dashboard (30/15/7/0-day horizons, per warehouse, expected loss).
- FR-4 Dead-stock markdown suggestions.
- FR-5 Expiry variance reporting.
- FR-8 Signed audit trail export (the compliance export backbone).
- Supporting: products.expiry_date backfill/sync from stock_batches; FEFO data available at POS.

### 6.2 Out of Scope for MVP

- FR-26/27 Owner Digest + anomaly alerts — v1.1 (third unlock, per the unlock order). `[NOTE FOR PM]` Digest is the highest-visibility quick win; keep its roadmap slot ahead of deeper v2 features.
- FR-10..13 HMO/NHIS claims engine — v1.1 (second unlock, ahead of digest), depends on payer template work.
- FR-14/15 Debt dunning + credit scoring — v1.1.
- FR-16 Shift reconciliation — v1.1.
- FR-6/7/9 Controlled-drugs register, one-click compliance bundle, recall feed — v1.1, high value, needs regulatory template work. `[NOTE FOR PM]` Recall feed is emotionally load-bearing for regulated owners — revisit if timeline permits.
- FR-17..20 CareFind booking, loyalty, storefront, referral monetization — v2.
- FR-21..25 Clinical depth (e-Rx, lab push, patient timeline, inpatient, CDS) — v2/v3, hospital-focused.
- FR-28 AI assistant — v2 (read/query), v3 (draft); autonomous actions never in v1.
- FR-22 lab results push — v2.
- Moonshots (CareHub Pay, Health ID, drug authenticity, cold-chain, group purchasing, market data product) — not scheduled; tracked in the task-list appendix.

## 7. Success Metrics

**Primary**
- **SM-1**: Expired-batch POS blocks — count of blocks + overrides per month. Target: >0 blocks recorded, override rate <5% of blocked attempts within 90 days of launch. Validates FR-1, FR-2, FR-8.
- **SM-2**: Expiry loss reduced — expected-loss value in the 30-day horizon falls ≥20% within 90 days of launch (write-offs from expiry vs baseline). Validates FR-3, FR-4, FR-5.
- **SM-3**: Owner Digest engagement — ≥60% of owners open the digest ≥5 days/week; attention items acted on ≥50% of the time. Validates FR-26, FR-27.
- **SM-4**: Premium tier conversion — share of paying businesses on Growth/Hospital/Enterprise tiers. Target: +15 percentage points within 180 days of launch vs pre-launch mix. Validates the overall premium proposition.

**Secondary**
- **SM-5**: Support load — expiry/inventory-related support tickets fall 30% after expiry safety ships. Validates FR-1..5.
- **SM-6**: Audit coverage — 100% of override and void actions appear in audit exports within 24h. Validates FR-8.

**Counter-metrics (do not optimize)**
- **SM-C1**: Do not maximize block count — blocks are a failure signal; the metric's health is overrides near zero and expiry-loss falling. Counterbalances SM-1.
- **SM-C2**: Do not optimize digest send volume/cost below a floor that breaks delivery reliability; a cheap digest that never arrives is worse than none. Counterbalances SM-3.

## 8. Open Questions

1. HMO/NHIS claim submission — API vs email/CSV per payer? (FR-11)
2. Paystack collection-link credit for debt payments — reconciliation rules? (FR-14)
3. WhatsApp Business API vs SMS fallback — cost model per plan tier? (FR-14, FR-26)
4. Markdown approval chain — does a branch manager approve or must it reach the owner? (FR-4)
5. products.expiry_date sync strategy — backfill job vs trigger on stock_batches? (FR-3 dependency)
6. Audit export — checksum/signing mechanism acceptable to NAFDAC/PCN inspectors? (FR-8)
7. Digest delivery timezone/cadence defaults per business type? (FR-26)
8. Batch attribution — how do held sales and resume-hold flows attribute Batches when the line is charged later? (FR-1/FR-2 dependency)

## 9. Assumptions Index

- §2.2 Non-Nigerian markets are v3+.
- §4.2 FR-8 audit export excludes patient-identifiable data for non-privileged roles.
- §4.2 FR-9 recall alerts deliver through the digest channels.
- §4.3 FR-13 targets common Nigerian HMO/NHIS schemes; payer templates are configurable.
- §4.4 FR-14 message cost is metered per business.
- §4.5 FR-19 delivery management is in-house, no third-party courier.
- §4.5 FR-21 printable prescriptions exist for patients without smartphones.
- §4.6 FR-22 results access requires consent or secure link.
- §4.6 FR-22 sending is metered per result.
- §4.7 FR-26/27 WhatsApp/email/SMS metered within a configurable per-business budget.
- §5 Native Android apps are v2+.
