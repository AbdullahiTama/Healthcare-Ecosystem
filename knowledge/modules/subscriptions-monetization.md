# Subscriptions & Creator Monetization — Business Domain

## Purpose
Lets a verified professional on CareFind monetize their presence: paid subscriber tiers, paid one-off consultations, paid tasks, and gifting — the domain that answers "Subscriptions," listed as an example domain in this review's scope. Not present in CareHub under any name despite CareHub's own `README.md` listing "Subscription Management" as a product responsibility.

## Files
`apps/carefind/carefind-main/src/ProfessionalMonetization.jsx` (383 lines), `GiftPanel.jsx` (199 lines), `subscriptions.js` (81 lines, in `src/`, not `lib/`).

## Components
`ProfessionalMonetization.jsx` — a single dashboard covering subscriber-price editing, active-subscriber list, consultation setup/history, open tasks, task submissions, and wallet balance in one component. `GiftPanel.jsx` — a separate gifting UI, presumably used from the Social Feed or Live Streaming domains during content interaction.

## Services
Direct `supabase-js` calls: `subscriptions` (a professional's own price-per-tier row), `user_subscriptions` (subscriber relationships, joined against `profiles` for display), `consultations` (**a table name also used by CareHub for an unrelated clinical concept — see `patient.md` and `Database.md`'s ecosystem-wide finding on this collision**), `tasks`, `task_submissions`, `wallets` (read-only balance display). `submitConsultationSetup()` inserts a `consultations` row with `professional_id`, `patient_id` (the professional's own user id at setup time), `type`, `fee`, `status: 'setup'`.

## Dependencies
`lib/AuthContext.jsx`, the Wallet & Payments domain (balance display), `notify.js` (`gift`, `product_available` notification types suggest this domain's events feed the shared notification system).

## Database Tables
`subscriptions`, `user_subscriptions`, `creator_subscriptions`, `product_subscriptions`, `consultations` (CareFind's own — the naming collision with CareHub's clinical table), `tasks`, `task_submissions`, `gifts`, `wallets` (read).

## Current State
Subscriber-tier pricing, subscriber management, task browsing/submission, and consultation setup are all implemented. **The `consultations` table name collision with CareHub's clinical records domain is unresolved** — this document set could not determine whether the two products' `consultations` references point at one physical table or two, and this is the single highest-priority verification item flagged across the entire `architecture/` and `knowledge/` document sets.

## Missing Documentation
No document acknowledges that this domain is CareFind's actual implementation of what CareHub's own documentation calls "Subscription Management" — the two products' documentation does not cross-reference this at all. No document resolves the `consultations` naming collision. No document states whether "Billing" (see `billing.md`, a CareHub documentation gap) was ever intended to relate to this domain's payment/subscription logic.
