# 04 — Business Modules

Every business module identified across both products, each with a concise "how it currently works" summary. Full per-module treatment (Purpose/Files/Components/Services/Dependencies/Database Tables/Current State/Missing Documentation) lives in `knowledge/modules/*.md` — 38 files, linked below by name. Where the aspirational `Business-Domain-Model.md` glossary uses different vocabulary for the same concept, that's noted.

## CareHub Modules

**Inventory** (`inventory.md`) — Product catalog CRUD for retail-style businesses. Add/edit/restock/CSV-import/duplicate-merge all work. Stock is not reliably accurate: POS never persists a sale's stock decrement. No FEFO/batch/expiry tracking despite "Batch" and FEFO being defined concepts in both `knowledge/glossary/TERMS.md` and the aspirational manual's `Business-Domain-Model.md` — that capability exists only in the separate, disconnected enterprise Stock & Batches module.

**Point of Sale** (`point-of-sale.md`) — Cart, discount, split/credit payment, held sales, offline queue. Functionally complete as a checkout UI; its stock-decrement never reaches the database (see Inventory).

**Clients** (`clients.md`) — Generic CRM record. Relabeled "Patients" in the sidebar for hospital tenants but shares no data with the actual clinical `patients` table.

**Patients** (`patient.md`) — The real clinical pipeline: Reception → Triage → Doctor → (Lab/Imaging, optional) → Pharmacy → Discharge, driven by a `patients.status` string with no shared state-machine definition. Reception→Triage→Doctor works; the pipeline dead-ends for any visit that goes to Lab/Imaging without also going to Pharmacy — those patients are never discharged by anything in the codebase.

**Hospital Workflow** (`hospital.md`) — The business-type-vertical wiring around the Patients pipeline: a different sidebar, a different dashboard-home widget, and route access that is *not* actually gated by business type — only hidden from nav.

**Laboratory** (`laboratory.md`) — Lab technician result entry against doctor-ordered tests. Never advances patient status (part of the pipeline dead-end above). Its test catalogue has drifted from the subset Doctor's own quick-add UI offers.

**Imaging** (`imaging.md`) — Radiographer report entry, structurally parallel to Laboratory, same dead-end, no priority field at all (Lab has one).

**Pharmacy** (`pharmacy.md`) — "Community Pharmacy" is a selectable business type, but the prescription-dispensing pipeline the codebase itself labels "Pharmacy" is wired exclusively into the Hospital vertical's nav — a standalone pharmacy tenant cannot reach it. A pharmacy tenant's actual workflow is just Inventory + POS.

**Appointments** (`appointments.md`) — Full CRUD scheduling, isolated from Reception — no link between a booked appointment and a registered patient.

**Expenses** (`expenses.md`) — Logging works; a monthly budget-tracker feature exists but is `localStorage`-only, not backed by any table, despite UI copy implying it's shared across staff.

**Debts** (`debts.md`) — Bidirectional ledger, auto-populated from POS and Purchases via independently-written reconciliation logic in each.

**Purchases** (`purchases.md`) — Supplier purchase records; `product_name` is free text with no link to Inventory, so receiving stock here never updates the catalog.

**Staff Management** (`staff-management.md`) — Add/deactivate staff, CareFind claim approval. The full roster (including emails) is visible to any role that navigates there directly — only the mutation buttons are role-gated, not the list.

**Reports** (`reports.md`) — Cross-domain financial summary with a working CSV export; all aggregation is computed client-side over unbounded fetches.

**Settings** (`settings.md`) — Business profile + receipt customization. The one CareHub page that correctly gates its *entire* render behind a role check rather than hiding individual buttons.

**Billing** (`billing.md`) — **No dedicated implementation exists.** Documented in `README.md` as a CareHub responsibility; the functionality that would constitute it is distributed across POS/Debts/Purchases, and `Landing.jsx`'s subscription pricing tiers are static marketing copy with zero backend wiring.

**CareFind Listing** (`carefind-listing.md`) — Per-product/business visibility toggle for the CareFind platform. Duplicated: the exact same toggle exists both here and inside Inventory's own product table.

**Locations** (`locations.md`) — Multi-branch view and branch creation. Its "Switch to this branch" action calls `setAuth`, a function `AuthContext` does not expose — very likely a runtime crash as deployed.

**Warehouses, Territories, Messages, Stock & Batches, Orders, Field Activity** (`warehouses.md`, `territories.md`, `messages.md`, `stock-batches.md`, `orders.md`, `field-activity.md`) — The manufacturer/wholesale ("Enterprise") vertical. Six functionally substantial modules (Orders' approval pipeline and Field Activity's live-tracking/audio/CSV-export system are the most complex screens in CareHub) built in a visibly different code style from the rest of the app, with a real audit trail in Stock & Batches that the generic Inventory module lacks entirely.

## Cross-Product Modules

**Authentication** (`authentication.md`) — Four separate systems; see `05-authentication.md` for full detail.

**Permissions** (`permissions.md`) — CareHub-only role/nav matrix (`lib/permissions.js`), UI-enforcement only. CareFind has no equivalent.

**Platform Administration** (`platform-administration.md`) — Two entirely separate admin back offices: CareHub's `AdminDashboard.jsx` (business approval) and CareFind's `AdminPanel.jsx` (the largest file in either product — content moderation, claims, transactions), the latter sitting behind a forgeable authentication scheme.

**Notifications** (`notifications.md`) — Two independent implementations, different tables, both correctly designed to fail silently on write errors (a genuine point of convergent design between otherwise-unrelated teams).

## CareFind-Specific Modules

**Healthcare Discovery** (`healthcare-discovery.md`) — Search + drug lookup. The one part of CareFind that matches its documented product purpose.

**Business Profiles & Reviews** (`business-profiles-reviews.md`) — Public listings, ratings, and both rule-based and AI-powered sentiment analysis (the latter possibly non-functional — missing API auth headers).

**Social Feed** (`social-feed.md`) — CareFind's largest single file (`Feed.jsx`, 1,823 lines). Confirms CareFind is implemented predominantly as a social platform, not a discovery platform.

**Stories, Live Streaming** (`stories.md`, `live-streaming.md`) — A ~1,900-line cluster (LiveSession/LiveShow/LiveDashboard/GoLive/etc.) not individually read this engagement — flagged as the largest unverified surface in either codebase.

**Wallet & Payments** (`wallet-payments.md`) — Balance, funding, transaction history, paired with the one genuinely well-built payment integration (`paystack-webhook.js`) — whose deployment location may make it unreachable (see `07-api.md`).

**Subscriptions & Creator Monetization** (`subscriptions-monetization.md`) — This is CareFind's actual implementation of what CareHub's docs call "Subscription Management." Its `consultations` table is the source of the ecosystem's unresolved name collision with CareHub's clinical `consultations` table.

**News & Publishing, Playlists** (`news-publishing.md`, `playlists.md`) — Editorial and curated-content features, lightly verified.

**Claims** (`claims.md`) — The `staff_claims`/`business_claims` bridge to CareHub — the single best example of real, working cross-product integration in the entire ecosystem.

## Vocabulary Note

The aspirational `Business-Domain-Model.md` defines "Organisation," "Branch," "Customer" (distinct from "Patient"), "Invoice," and "Subscription" as core business entities. The implemented codebase's closest equivalents are, respectively: `businesses` table, `parent_business_id`/Locations module, the `clients` table (which is genuinely distinct from `patients`, matching this glossary's Patient/Customer split more closely than expected), no dedicated invoice concept (folded into `sales`), and no implementation at all (see Billing above).
