# CareFind Updated Feature Changelog

Append-only log for the 10-feature UPDATED PENDING ISSUES program.
Never erase historical entries.

---

## 2026-08-14 — Feature 1: Products WhatsApp + Call

**What:** Ensure every product-listing surface offers both a WhatsApp deep link
and a Call deep link.

**Audit findings:**
- CareFind buyer surfaces (Search product cards, DrugProfile "Where to buy"
  seller cards, BusinessProfile facility card) already render WhatsApp **and**
  Call via `whatsappLink`/`telLink`, with Nigerian number normalisation
  (`080…` → `234…`) covered by 34 `marketplace.test.js` cases.
- **Missed surface:** the CareHub `CareFind.jsx` module — the business owner's
  "CareFind public view" preview — showed only `WhatsApp: <number>`, with no
  Call button.

**Changes:**
- `packages/shared-marketplace/src/index.js`: added `whatsappLink(contact,
  message)` and `telLink(contact)` (single normalisation source: strip
  non-digits, `0…` → `234…`, bare/passthrough `234…`/`+234…`, `null` on empty
  input so buttons hide). Added `normalizeContact` internal helper.
- `packages/shared-marketplace/src/index.test.js`: 6 new cases (null inputs,
  Nigerian normalisation for wa.me, message encoding, tel: passthrough and
  formatting strip). Suite now 13/13.
- `apps/carefind/src/modules/utils/marketplace.js`: removed the local
  `whatsappLink`/`telLink` copies and re-exported them from the shared package
  so every existing CareFind import path is unchanged. Marketplace suite 34/34.
- `apps/carehub/src/modules/carefind/CareFind.jsx`: import `whatsappLink`/
  `telLink` from the shared package (replacing the hand-rolled `wa.me` string
  build) and render a `Call: <phone>` link next to WhatsApp in the public-view
  preview using the business's `phone`.

**Verification:**
- Shared package 13/13, CareFind 257/257, CareHub 306/306 tests pass.
- `npm run build` clean for both `apps/carehub` and `apps/carefind`.
- Manual checks: preview renders both links when `brand.whatsapp` and
  `brand.phone` are set; each link hides itself when its number is missing;
  `wa.me` and `tel:` hrefs normalise Nigerian numbers identically to CareFind.