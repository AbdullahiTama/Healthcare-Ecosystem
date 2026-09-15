# PRD Quality Review — CareHub Premium Value Upgrade

## Overall verdict

This is a well-shaped, substantive PRD: the thesis (expiry → claims → digest as the trust-and-growth unlock) is concrete, the FRs carry testable consequences, the assumptions index roundtrips cleanly, and the three UJs have named protagonists that actually drive the scope. What holds it back is one load-bearing brownfield premise that is silently wrong — the P0's FEFO/Expired-Batch Block presumes POS sale lines already reference batches and that batch quantities decrement on sale, neither of which is true in the existing product — plus an internal contradiction between the stated unlock order and the MVP scope, and a primary commercial metric left "to define at launch." Decision-makers would green-light the P0 without seeing its largest technical dependency.

## Decision-readiness — adequate

The PRD genuinely surfaces tensions: `[NOTE FOR PM]` lands at real pressures (FR-25 CDS medical-accuracy liability at §4.6; recall feed "emotionally load-bearing" at §6.2; `products.expiry_date` sync dependency at §4.1), the Open Questions in §8 are honestly open (API vs email/CSV per payer; WhatsApp Business cost model; markdown approval chain), and counter-metrics SM-C1/SM-C2 show someone thought about perverse incentives. Two things blunt decision-readiness.

First, the PRD's central feasibility claim — "the expiry data is already captured at purchase and in `stock_batches`" (§4.1, line 97) and MVP "Supporting: FEFO data available at POS" (§6.1, line 426) — frames the P0 as mostly assembling existing data. In the actual codebase this is not a backfill. POS sale lines are a free-form JSON blob (`items: JSON.stringify(cart)` in `apps/carehub/src/modules/pos/POS.jsx`; the sale repository in `apps/carehub/src/modules/pos/repositories/index.js` writes `sales` rows with no batch id), nothing decrements `stock_batches.quantity` on sale (no trigger on `sales`/`stock_batches`/`stock_movements` — confirmed in `architecture/Technical-Debt.md` C5; `products.stock` is overstated by every unit ever sold), and the batch system is "entirely disconnected from the Products service's `products.stock`" (`architecture/Service-Catalog.md`). A decision-maker reading this PRD cannot see that FR-1, FR-2, and FR-5 all require a sales→batch linkage that does not exist — the largest cost and risk in the MVP is not named anywhere, not even as an Open Question.

Second, the unlock order stated in §1 ("FEFO + expired-batch block first, then the HMO/NHIS claims engine, then the owner digest") is contradicted by §6.1: the MVP includes the digest (FR-26/27 — the *third* unlock) and excludes the claims engine (FR-10..13 — the *second* unlock). A decision-maker asked "why does the digest ship before claims?" gets no answer in the PRD.

### Findings
- **[critical]** P0 premise has no basis in the existing sale data model (§4.1 FR-1/FR-2/FR-5, §6.1) — Sale lines carry no batch reference and batch/`products` stock is not decremented on sale anywhere in the product (verified: `pos/repositories/index.js`, `POS.jsx`, `architecture/Technical-Debt.md` C5). FR-1 "the system defaults to the Batch…", FR-2 "cannot complete a sale line whose only stock reference is an Expired Batch", and FR-5 "reconciles purchases, sales, transfers, and expiry write-offs per Batch" are all impossible without first introducing batch-linked sale lines and batch quantity decrement — work the PRD compresses to "FEFO data available at POS." *Fix:* add an explicit MVP dependency/risk section naming the sale→batch linkage and stock-decrement work (C5), and an Open Question for how offline-queued sales are batch-validated on replay (the offline queue replays sales later with no re-validation path).
- **[high]** Unlock-order narrative contradicts MVP scope (§1 line 23 vs §6.1/§6.2) — The third unlock (digest, FR-26/27) is in MVP while the second unlock (claims engine, FR-10..13) is v1.1. *Fix:* re-sequence the §1 narrative to match scope (digest as a quick-win support inside the P0) or add the missing argument for why digest precedes claims.

## Substance over theater — strong

No persona theater: Ada, Tunde, and Ngozi each carry a decision the PRD actually makes (override auditing, digest actioning, batch claim submission), and the edge cases (licensed override, "all clear" digest, denied claim re-submission) are product decisions, not decoration. The Vision is CareHub-specific (the ₦8k–₦80k band, expired-batch loss, NAFDAC/PCN dread) and would not transplant. FEFO, claims, and the digest are credible differentiators against cheap POS-only competitors rather than invented novelty. The one theatrical line is §2.1's ninth JTBD — "owner digest, anomaly alerts, **voice briefing**" — which no FR realizes; voice briefing is a moonshot in the source intent and is never re-referenced.

### Findings
- **[low]** Voice briefing surfaces as a JTBD but has no feature (§2.1) — Listed as delivered ("I want to look modern and be in control from my phone"), but no FR, section, or scope entry realizes it. *Fix:* drop it from the JTBD or tag it `[ASSUMPTION] v3`.

## Strategic coherence — thin

The thesis is real and the arc is coherent in principle: stop revenue bleeding (expiry safety), recover cash (claims), then give the owner answers (digest). But the PRD's own sequencing claim is violated by its own scope (§1 vs §6, see Decision-readiness), and the MVP composition — why FR-8 audit export and the digest are in the P0 while the claims engine — the explicitly second unlock — is not — is asserted as "the P0 unlock" rather than argued. Success metrics are mostly aligned to outcomes (SM-2 expiry-loss reduction, SM-3 digest *engagement quality* with a counter-metric) rather than activity, which is good; but SM-4, the only metric that validates the commercial thesis ("premium tier conversion"), has its target "define at launch," and SM-5 measures features that are explicitly out of the MVP. The MVP's scope kind is problem-solving with revenue intent, but the mix isn't defended as a coherent slice.

### Findings
- **[high]** Primary commercial metric has no target (§7 SM-4) — "Target: define at launch" on the single metric that proves the premium-upgrade bet; also mixes tiers ("Basic/Growth upgrading to growth/hospital") with no definition of what "premium" means vs those tiers. *Fix:* commit a target and define the premium tier boundary before green-light.
- **[medium]** SM-5 validates features not in the MVP (§7 vs §6.2) — "compliance/expiry-related support tickets fall 30% after bundle + expiry safety ship" cites FR-6..9, which are explicitly v1.1. *Fix:* scope the metric to the MVP features (FR-1..5, FR-8) or move SM-5 to a v1.1 metric.

## Done-ness clarity — adequate

This is the strongest routine dimension: nearly every FR carries concrete, testable consequences (FR-2's inline block message naming batch + expiry; FR-17's "payment failures do not create confirmed bookings"; FR-24's discharge closing the stay and posting to the timeline). Soft-bound residue: the cross-cutting NFR "must not add measurable latency to checkout under 2G" has no threshold or test (what is "measurable"?), FR-26 "delivered on schedule" is unbounded, and FR-9's "the feed ingests recall notices" never says from where or in what format — an un-speccable ingestion point for a regulatory feature.

### Findings
- **[medium]** NFR latency bound is an adjective, not a number (§4.7) — "must not add measurable latency" is exactly the boilerplate the rubric flags. *Fix:* give a threshold and measurement (e.g., FEFO resolution adds <150 ms p95 on a 2G-emulated network, measured in the existing POS e2e/perf path).
- **[medium]** Recall feed has no data source (§4.2 FR-9) — "ingests recall notices and matches against catalog + Batch data" never identifies where NAFDAC notices come from (scraper, vendor feed, manual entry), cadence, or format, and there is no Open Question for it. *Fix:* name the ingestion mechanism or add it to §8.

## Scope honesty — adequate

Non-Goals (§5) do real work (no adjudication engine, no horizontal POS, no native apps, no courier integration, no autonomous AI), de-scoping in §6.2 is explicit and tiered, and the recall-feed and CDS-liability `[NOTE FOR PM]` callouts are placed where tension actually lives. Assumptions are tagged and indexed with a clean roundtrip. The critical gap is the same one as Decision-readiness: the P0's dependency on sales→batch linkage is an omission of the "silently assumed" kind the rubric is pointed at — the reader would assume "FEFO data available at POS" is a data-readiness task when it is a data-model and write-path change.

### Findings
- **[critical]** Foundational P0 dependency omitted, not de-scoped (§4.1, §6.1) — The largest MVP cost — making POS sale lines batch-aware and decrementing batch quantity on sale — is never named as in-scope work, a risk, or an open question. *Fix:* add it to §6.1 "Supporting" or as a risk with an estimate; add an Open Question.

## Downstream usability — strong

IDs are contiguous and unique (FR-1..28, UJ-1..3, SM-1..6 + SM-C1/C2), cross-references resolve ("Realizes UJ-1/2/3"; the digest links to the FR-3 dashboard), each UJ has a named protagonist with context inline, and the Glossary is used consistently (Batch/Expired Batch/FEFO/Licensed Override/Payer/Scheme/Claim appear identically across FRs and UJs). Mechanical gaps are light: the Glossary defines GRN and UoM, which no FR references, while feature nouns used as deliverables (Anomaly Alert, Credit Score, Storefront, Inpatient, Loyalty Points) are absent from it.

### Findings
- **[low]** Glossary drift at the margins (§3) — GRN and UoM are defined but never used; Anomaly Alert, Credit Score, Storefront, Inpatient, Loyalty Points are used as feature nouns but undefined. *Fix:* prune or add for downstream story creation.

## Shape fit — adequate

Shape fits the product: multi-stakeholder B2B with meaningful UX → UJs with named protagonists are load-bearing, present, and correct. Brownfield accuracy is the weak spot. Most existing-code references check out against the repo (`products.expiry_date` migration was indeed fixed and applied live per `_bmad-output/implementation-artifacts/spec-purchase-expiry-live.md` with the backfill still open per `_bmad-output/implementation-artifacts/deferred-work.md`; the offline sale queue exists at `carehub_v1_offline_sales`; the referral-agent program exists). But the central brownfield claim — that the expiry P0 is an assembly of already-captured data — is inaccurate by omission: the sale flow has no batch dimension, which is precisely the "existing-code references must be accurate" requirement for brownfield shape fit.

### Findings
- **[critical]** Brownfield claim inaccurate by omission (§4.1, §6.1) — Same root as the Decision-readiness/Scope-honesty criticals; the PRD asserts the expiry data is "already captured" as if FEFO follows, while the existing sale pipeline (`pos/repositories/index.js`, `POS.jsx`) has no batch reference and no sale-time stock decrement (`Technical-Debt.md` C5). *Fix:* ground the P0 in the verified sale/batch reality before launch gating.

## Mechanical notes

- **ID continuity:** Clean. FR-1..28, UJ-1..3, SM-1..6 + C1/C2 are contiguous and unique; cross-references resolve.
- **Assumptions Index roundtrip:** Clean. All eleven inline `[ASSUMPTION]` tags appear in §9 and all §9 entries appear inline (§2.2, FR-8, FR-9, FR-13, FR-14, FR-19, FR-21, FR-22 ×2, §4.7 budget, §5 Android).
- **Glossary drift:** Minor (§3) — two unused entries (GRN, UoM), several undefined feature nouns (see Downstream usability finding).
- **UJ protagonists:** Strong — Ada, Tunde, Ngozi each carry context and a decision inline.
- **Required sections:** Present for launch/commercial stakes (Vision, JTBD, Glossary, FRs with consequences, Non-Goals, MVP scope, metrics + counter-metrics, Open Questions, Assumptions Index).