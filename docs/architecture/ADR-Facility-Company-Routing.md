# ADR: facility reports reach the selected manufacturer / importer

Last updated: 2026-11-19. Migration: `supabase/migrations/carehub_20270130_adr_facility_company_routing.sql`.
Related: [ADR-Routing-Foundation.md](ADR-Routing-Foundation.md), [ADR-PV-Tracker.md](ADR-PV-Tracker.md),
[audits/carefind-carehub-pv-routing-audit.md](../audits/carefind-carehub-pv-routing-audit.md).

## Problem (reported 2026-11-19)

Healthcare facilities could not select the manufacturer or importer responsible for the medicine when submitting an
adverse drug reaction report, so their reports never reached the company.

## Root cause (verified against the code and the live database, 2026-11-19)

The CareHub ADR form already had a company picker for each suspect product (`CompanySelector`), and the database
accepted a facility's selection (`create_adr_product_route`: a rolled-back probe as a facility owner created a pending
route). Two things still stopped facilities:

1. **Nothing after the selection handled facility reports.** Every later step was limited to `report_source = 'public'`:
   automatic routing at submission (`trg_adr_auto_route`, `adr_auto_route_report`), the reviewer queue
   (`list_adr_route_review_queue`) and the reviewer alert (`adr_notify_reviewers_on_submit`). A facility's selection
   stayed `pending` for ever and no company or reviewer ever saw it. Live: 12 of 14 public routes routed; 0 routes on
   50 facility reports.
2. **The picker looked empty.** After choosing "Select the company", nothing was listed until a name was typed and
   **Search** pressed (Enter did nothing). With only a handful of registered Manufacturer / Importer companies, a
   partial or different spelling found nothing, so it looked as though there was nobody to choose.

There was also a latent hazard: on a facility draft, choosing a different company **added** a second selection rather
than replacing the first (the replace rule was public-only). Once routing works, that would send the case to both.

## Change

Database (`carehub_20270130`, four function bodies plus one trigger condition; each body is otherwise byte-identical
to the live one, proven by hashing the live body with only the intended replacement applied):

- Facility reports (`business_facility`, `health_facility`) follow the same routing as public reports, at the same
  moment (draft to submitted, validation gate passed). A registered, still-eligible company the facility selected
  receives the case in its PV Tracker at once and is alerted. Typed names, "I don't know", a company that is no longer
  eligible, or a held route go to the platform reviewer queue, and reviewers are alerted. Reports whose source is
  `unknown` are still never routed automatically.
- On any draft, a new selection for a product **replaces** its pending one (audited: `routing_created` with
  `replaced_selection_kind`). Verified, routed, held or reviewed routes are never replaced; submitted reports are unchanged.

App (`CompanySelector.jsx`, `AdrReportPage.jsx`):

- Choosing "Select the company" lists the registered Manufacturer / Importer companies at once, starting from the
  **Manufacturer** typed on the product, and the list follows typing (250 ms pause) or Enter. Only the newest search
  result is shown. States: loading, none registered, no match, search unavailable (with the typed-name fallback).
- The picker says where the report goes and that the reporter's name and contact details are hidden from the company.
- Product chips read "will be sent when you submit", "awaiting review" (submitted, pending) or "sent to the company".
  Editing a product shows its current company by name.

## Security

- **Extends the owner's 2026-10-22 auto-routing decision** (`carehub_20261206`, public reporters) to facilities: a
  registered company picked by the facility receives the case at submission without a human check. The company sees
  what it sees for public cases (`adr_pv_case_view`): reporter name, facility name, phone, e-mail and licence masked;
  patient clinical data visible. Nothing verifies that the product belongs to the selected company; a wrong selection
  is a disclosure to that company.
- Mitigations: only active Manufacturer / Importer or Wholesale businesses are selectable; eligibility is re-checked
  at routing; a draft's selection can be changed (a replacement, so no stale second company); every routing is audited
  (`routing_routed`, `auto: true`). Facility reporters are signed-in registered businesses.
- No grants change. API roles still cannot write routing state (guard trigger from 20261113 / 20261114).

## Deployment order

Apply the migration, probe it, then deploy the app: the picker's new wording promises delivery at submission, which is
only true once the migration is live. The app works with either database (a selection is saved either way).

## Tests

- `apps/carefind/src/test/adr/facilityCompanyRouting.db.test.js` (15, PGlite replaying the real ADR migrations): the
  defect reproduced on the old schema; routed at submission and masked for the company; health-facility source;
  replacement on change and "I don't know"; reviewer queue, suggestions and alert for typed / unknown; reviewer
  redirect; ineligible company left for review; refusals (non-company business, outsider); write guard; submitted
  selection never replaced; unknown source not routed; public flow unchanged; grants. 7 fail without the migration.
- `apps/carehub/src/modules/adr/CompanySelector.behaviour.test.jsx` (9; 8 fail on the old picker) and the updated
  `CompanySelector.test.jsx`.

## Manual check

CareHub ▸ Reports ▸ ADR ▸ new report ▸ Suspect products ▸ Add product ▸ type a manufacturer ▸ "Select the company":
the registered companies are listed, the closest first ▸ pick one ▸ Save product: the chip reads "(will be sent when
you submit)" ▸ change it to another company and save: one chip, the new company ▸ complete and submit: the chip reads
"(sent to the company)" ▸ sign in as that company: the case is in PV Tracker with the reporter's details hidden.

## Not done here

- A reviewer "re-route" for a case already routed to the wrong company (`review_adr_product_route` acts on pending
  routes only); recorded in the 20261206 header as a follow-up.
- Registration of Manufacturer / Importer companies (owner decision D2 in ADR-Routing-Foundation.md): the picker can
  only list companies registered on CareHub (6 Manufacturer / Importer and 1 Wholesale on 2026-11-19).
