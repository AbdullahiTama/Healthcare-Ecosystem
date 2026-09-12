---
title: 'E-commerce Mandatory Terms, Segment Commission & Auto-Approval Gate'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_commit: '02c15642dba48520d711ff3c3e256ad30fc3f3ff'
review_loop_iteration: 0
context:
  - 'docs/PROJECT_OVERVIEW.md'
  - 'architecture/Current-Architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** E-commerce onboarding uses a generic `Submitted→Approved` flow with no segment-specific terms or commission disclosure, and product setup is only hidden in UI — direct PostgREST writes bypass the gate; commission is never stored with acceptance.

**Approach:** Gate `Ecosystem→E-commerce` on segment-specific, versioned full Terms (Retail 10% / Wholesale 5% / Distributor 2.5% vendor-paid) — resolve segment from `business_type`, show only that segment's terms with commission at top, require explicit checkbox before `Apply` enables, then auto-approve (`Approved`) and unlock setup; enforce same gate server-side for all setup writes and persist full audit.

## Boundaries & Constraints

**Always:** Rates from `apps/carefind/src/modules/shop/pricing.js:6` `COMMISSION_RATES` (never duplicate/invent; no manufacturer rate exists). Versioned `ecommerce_terms` per segment; store `terms_version_id` + `accepted_commission_rate` on `ecommerce_applications`. Backend gate for `ecommerce_products`/`images` writes is `is_ecommerce_vendor_approved()` (RLS `WITH CHECK` + repo `assertApproved`) — UI hiding alone insufficient. Approval unlocks setup but never auto-publishes products (Activate still needs description≥10 + category + ≥1 image). Loading/error/empty/responsive (375/768/1280)/a11y on all screens.

**Ask First:** Whether business-level `ecommerce_segment` column should override `business_type→segment` mapping.

**Never:** Generic terms for all segments; show one rate then charge another; hide commission; allow setup via direct URL/API when not `Approved`; auto-publish inventory on approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|----------------|----------------|
| Retail gate | New retail (`pharmacy`/hospital/retail family), no application | Full Retail Terms, `10% vendor-paid, deducted from payout` + `₦5,000→₦500→₦4,500`, Apply disabled until checked | Apply ignored, toast `Accept terms first` |
| Wholesale gate | `business_type='wholesale'` | Wholesale Terms only, `5%` disclosed | Same |
| Distributor gate | `business_type='manufacturer_importer'` | Distributor Terms only, `2.5%` disclosed | Same |
| Apply → auto-approve | Checked → Apply | `ecommerce_applications` → `Approved` with `segment`, `terms_version_id`, `accepted_commission_rate`, `applicant_user_id`, `acceptance_timestamp`, `submitted_at`, `approval_timestamp`, `audit_metadata`; setup unlocked | 400 if not accepted; 409 if no active terms |
| Block setup | `Not Applied`/`Rejected` does `upsertEcommerceProduct`/`addImage`/`activate` via UI or `POST /rest/v1/ecommerce_products` | Blocked → UI `E-commerce application required. Please review and accept…` + `Apply for E-commerce` CTA; repo throws `E_COMMERCE_NOT_APPROVED`; RLS rejects | 403 + reason |
| No auto-publish | Just Approved, no setup | Zero `Active` rows; Shop empty | — |
| Commission downstream | Shop order for Approved vendor | `commission_kobo = total*rate` matches `accepted_commission_rate` | Never fallback to other segment |
| Rejected/Suspended | Admin sets `Rejected`/`Suspended` | Setup blocked again | Show `rejection_reason` |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/modules/ecommerce/Ecommerce.jsx:1` -- Onboarding + inventory/setup UI; `app` state, `termsAccepted`, `handleSubmitApp(status='Submitted')`; add segment-resolved full-terms gate, Apply disabled, auto-approve, blocked banner + CTA.
- `apps/carehub/src/modules/ecommerce/repositories/index.js:1` -- Seam `createEcommerceRepository`; add `getTermsForSegment`/`getTermsById`, `resolveEcommerceSegment`, audit `submitApplication` (auto `Approved`), `assertApproved` guard on all setup writes.
- `apps/carehub/sql/20260830_ecommerce_foundation.sql:1` -- Base `ecommerce_applications`/`ecommerce_products`/`ecommerce_product_images` + tenant RLS; basis for new migration adding `ecommerce_terms` + `segment`/audit cols + `is_ecommerce_vendor_approved()` + Tighten write policies.
- `apps/carehub/src/lib/permissions.js:213` -- `BUSINESS_TYPES` taxonomy; source for `business_type→segment` mapping.
- `apps/carefind/src/modules/shop/pricing.js:6` -- Canonical `COMMISSION_RATES`; import, don't duplicate.
- `apps/carehub/src/modules/ecommerce.test.js:1` -- Existing 13 in-memory tests; extend for segment, acceptance, auto-approve, block, audit.
- `apps/carehub/sql/20260831_shop_conformance_v2.sql:16` -- Existing `is_ecommerce_vendor_approved` + `ecommerce_products public read` pattern to reuse for write gate.
- `apps/carehub/api/ecommerce-review.js:1` -- Admin review service-role endpoint; keep for later suspend/reject.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/sql/20260902_ecommerce_terms_auto_approval.sql` -- Create `ecommerce_terms(id, segment CHECK retail/wholesale/distributor, version, title, content NOT NULL, commission_rate numeric, is_active bool, created_at, UNIQUE(segment,version))` + seed 3 active rows (Retail 0.10 + `₦5,000→₦500→₦4,500` example at top, Wholesale 0.05, Distributor 0.025, full seller/fulfilment/refund/compliance text); alter `ecommerce_applications` add `segment`, `terms_version_id FK`, `accepted_commission_rate`, `applicant_user_id`, `acceptance_timestamp`, `approval_timestamp`, `audit_metadata jsonb`; add helpers `resolve_ecommerce_segment` + `is_ecommerce_vendor_approved`; tighten `ecommerce_products`/`ecommerce_product_images` write policies to `WITH CHECK (is_ecommerce_vendor_approved(business_id))`.
- [x] `apps/carehub/src/lib/ecommerceSegments.js` (new) -- Pure `SEGMENT_RATES {retail:0.10,wholesale:0.05,distributor:0.025}`, `resolveEcommerceSegment(businessType)` (`wholesale`→wholesale, `manufacturer_importer`→distributor, else retail; `ecommerce_segment` override if present), `commissionExample`; throw on invalid/future segment without rate.
- [x] `apps/carehub/src/modules/ecommerce/repositories/index.js` -- Add `getTermsForSegment`/`getTermsById`; validate `submitApplication` requires `terms_accepted`+`segment`+active `terms_version_id`, stamp `accepted_commission_rate`+timestamps and `status='Approved'`; add `assertApproved` guard on `upsertEcommerceProduct`/`addImage`/`reorderImages`/`deleteImage`/`activate`/`setStatus` throwing `E_COMMERCE_NOT_APPROVED: E-commerce application required…`.
- [x] `apps/carehub/src/modules/ecommerce/Ecommerce.jsx` -- Resolve `segment` from `brand.business_type`, fetch terms, render scrollable full-terms `Card` (`maxHeight 50vh`, commission badge at top), checkbox `I have read, understood and agree to the Terms & Conditions applicable to my E-commerce business segment.`; `Apply` disabled until checked; on Apply pass `applicant_user_id`+`audit_metadata`; show blocked banner + `Apply for E-commerce` CTA when not Approved and setup attempted; keep loading/error/empty/responsive/a11y.
- [x] `apps/carehub/src/modules/ecommerce.test.js` -- New cases: segment isolation (Retail 10% only / Wholesale 5% only / Distributor 2.5% only), full terms readable, submit without acceptance throws, success sets `Approved`+audit, unapproved setup throws `E_COMMERCE_NOT_APPROVED` via repo, approval doesn't publish products.
- [x] `apps/carehub/src/lib/__tests__/ecommerceSegments.test.js` (new) -- Mapping `wholesale→wholesale`, `manufacturer_importer→distributor`, `pharmacy/hospital→retail`, invalid throws.

**Acceptance Criteria:**
- Given new Retail business at Ecosystem→E-commerce, when viewed then only Retail full Terms with `10%` + `₦5,000→₦500→₦4,500` before checkbox, Apply disabled until checked
- Given Wholesale/Distributor, then only `5%`/`2.5%` terms shown respectively
- Given unchecked Apply clicked then blocked with warning; given checked then stored as `Approved` automatically (no admin) with `terms_version_id`, `accepted_commission_rate`, `acceptance_timestamp`, `approval_timestamp`, `applicant_user_id`
- Given `Not Applied`/`Rejected` tries direct `POST /rest/v1/ecommerce_products` then 403 `E_COMMERCE_NOT_APPROVED` and UI shows `E-commerce application required…` + CTA (backend enforced)
- Given just Approved then inventory setup unlocked but zero Shop products until `description`+`category`+image+explicit Activate; Activate still blocked when incomplete
- Given Retail approval then `commission_kobo` downstream equals `0.10*total`; Wholesale 0.05; Distributor 0.025; stored rate matches calculation

## Spec Change Log


## Design Notes

Mapping is pure function, no DB lookup; `manufacture_importer→distributor` closes enterprise gap without inventing a rate. `is_ecommerce_vendor_approved()` is hard gate (RLS) with repo pre-check for fast UX; future segment needs a row in `ecommerce_terms` with explicit rate before being offered.

## Verification

**Commands:**
- `npm test -- src/modules/ecommerce.test.js --reporter=verbose` -- expected: ≥20 passed
- `npm test -- src/lib/__tests__/ecommerceSegments.test.js --reporter=verbose` -- expected: mapping cases passed
- `npm run build --workspace=apps/carehub` -- expected: clean

**Manual checks:**
- Retail new → scroll Retail 10% terms → check → Apply → Approved → Setup+Activate works
- Wholesale 5% only; Distributor 2.5% only
- Unapproved `POST ecommerce_products` → 403/policy violation; UI blocked banner
- Approved no setup → Shop empty; after image+Activate → Shop visible

## Suggested Review Order

**Migration & commission truth**

- Versioned terms table with 10%/5%/2.5% seeds and audit columns
  [`20260902_ecommerce_terms_auto_approval.sql:13`](../../apps/carehub/sql/20260902_ecommerce_terms_auto_approval.sql#L13)

- Trim-aware segment resolver and hardened approved helpers + RLS/trigger gates
  [`20260902_ecommerce_terms_auto_approval.sql:99`](../../apps/carehub/sql/20260902_ecommerce_terms_auto_approval.sql#L99)

**Segment mapping — single source**

- Pure retail/wholesale/distributor mapping and commission guard
  [`ecommerceSegments.js:1`](../../apps/carehub/src/lib/ecommerceSegments.js#L1)

**Repository seam — auto-approve and backend gate**

- Terms fetch (trimmed, sorted) and auto-approve with audit and commission parity check
  [`repositories/index.js:29`](../../apps/carehub/src/modules/ecommerce/repositories/index.js#L29)

- Approved guard for all setup writes (upsert/image/reorder/delete/activate/setStatus)
  [`repositories/index.js:146`](../../apps/carehub/src/modules/ecommerce/repositories/index.js#L146)

**UI — mandatory gate**

- Segment-resolved full terms gate with commission badge and disabled Apply
  [`Ecommerce.jsx:47`](../../apps/carehub/src/modules/ecommerce/Ecommerce.jsx#L47)

- Blocked-setup banner with CTA and locked inventory state
  [`Ecommerce.jsx:384`](../../apps/carehub/src/modules/ecommerce/Ecommerce.jsx#L384)

**Tests — matrix coverage**

- 41 in-memory tests for segment isolation, auto-approve, blocked setup, commission
  [`ecommerce.test.js:1`](../../apps/carehub/src/modules/ecommerce.test.js#L1)

- Pure segment mapping and drift guard (16 tests)
  [`ecommerceSegments.test.js:1`](../../apps/carehub/src/lib/__tests__/ecommerceSegments.test.js#L1)
