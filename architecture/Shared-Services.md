# Shared Services — The CareHub ↔ CareFind Relationship

This document exists to answer one question directly, against implementation rather than documentation: *does CareFind actually "consume data originating from CareHub" and "never own business data," as the ecosystem's stated architecture philosophy claims?* Verified this session by reading CareFind's live `Search.jsx`, `BusinessProfile.jsx`, `AdminPanel.jsx`, `ClaimBusiness.jsx`, `ClaimStaffPosition.jsx`, and `BusinessDashboard.jsx` against CareHub's `lib/supabase.js` and `Staff.jsx`.

**Answer: partially true, partially false, in both directions.** There is no shared service layer, no shared npm package, and no shared types between the two codebases anywhere. The only thing connecting them is a handful of tables — **confirmed, not inferred, this pass**: CareHub's `lib/supabase.js` and CareFind's `lib/supabaseClient.js` contain the identical Supabase project URL (`szdybxmgmhndoytqanfb.supabase.co`) and the identical anon key. This is one physical Supabase project, proven directly rather than assumed from matching table names.

---

## 1. What's genuinely shared and working

### `businesses` and `products` — the core, documented relationship
CareHub's Inventory/Settings/Register write these; CareFind's `Search.jsx`/`BusinessProfile.jsx` read them, filtered by two boolean flags CareHub's UI controls: `visible_on_carefind` (business-level) and `list_on_carefind` (product-level). This is real, working, and matches the documented philosophy — as far as it goes.

### `staff_claims` — the ecosystem's best example of real cross-product integration
A CareFind end-user (their own Supabase-Auth `user_id`) can browse to `/claim-staff-position`, find a staff record CareHub's `Staff.jsx` created for them, and submit a claim. CareHub's `Staff.jsx` shows the pending claim to the business Owner (in a "🔔 Pending CareFind Claims" panel) and calls `approveStaffClaim`/`rejectStaffClaim`. Both sides read and write the identical table, with a real, coherent, two-sided workflow — genuinely well-designed, and proof the two teams *can* coordinate through the shared database when they choose to.

### `business_claims` — the second working bridge
CareFind's `ClaimBusiness.jsx` lets a user claim ownership of an unclaimed `businesses` row; `AdminPanel.jsx`'s `approveClaim()` — running entirely inside CareFind's own admin panel — then **writes back to CareHub's own table**, setting `businesses.visible_on_carefind = true`. This means CareFind's admin surface can flip a visibility flag on a record CareHub considers its own, with no CareHub-side awareness that this happened beyond seeing the flag change. Once approved, `BusinessDashboard.jsx` (CareFind) lets the claiming user manage that business's public listing/products from CareFind's side — a genuine, if one-directional-feeling, management surface layered on top of CareHub's data.

---

## 2. Where the philosophy breaks down

### CareFind owns real "business data"
`reviews` — a rating and comment tied to a `business_id` — is created, stored, and is authoritative for entirely by CareFind, via CareFind's own auth. This is squarely "business data" (it's about the business, and businesses/CareHub owners may reasonably expect to manage or at least see it in one place) that CareHub has zero code-level awareness of. `profiles`, `search_logs`, and `promotions` are further CareFind-owned data with no CareHub counterpart or bridge.

### CareFind depends on `products` columns CareHub's UI cannot set
`Search.jsx`/`BusinessProfile.jsx` select `whatsapp, image_url, sale_type, price_unit, min_purchase, seller_location` from `products`. **None of these fields exist in CareHub's `Inventory.jsx` `ProductModal`** (its fields are name, generic name, category, price, cost price, stock, reorder level, barcode, and the CareFind visibility toggle only). **Resolved (as a finding, not a fix) this engagement**: a repo-wide grep of `apps/carehub/src` for `image_url`/`sale_type`/`price_unit`/`min_purchase`/`seller_location` returned zero matches anywhere — not just absent from `ProductModal`, absent from the entire codebase. The earlier "a write path may exist somewhere not yet checked" caveat is closed — confirmed there isn't one. CareFind's richer marketplace UI (wholesale badges, minimum-purchase quantities, per-product photos, per-product WhatsApp contact) is decorative for every real CareHub-originated product, since nothing populates those fields — a product decision is needed on whether to build the write path or accept the gap (`Technical-Debt.md` H9).

### Two independent, differently-named admin systems
CareHub: `admin_team`. CareFind: `admin_teams` **and** `admin_users` (two tables, queried together in `AdminPanel.jsx`). These are almost certainly meant to be entirely separate concepts (each product's own internal back-office roster) rather than a collision, but the near-identical naming with no shared convention is itself a sign the two teams built their admin systems without reference to each other.

### The `consultations` naming collision (unresolved — see `Database.md`)
CareHub's `consultations` (clinical diagnosis record, written by `Doctor.jsx`) and CareFind's `consultations` (paid-consultation-booking record for creator monetization, written by `ProfessionalMonetization.jsx`) share a table name with completely unrelated schemas and purposes. This document cannot determine from source alone whether these are one physical table or two — **this is the single highest-priority item to verify directly against the live Supabase schema before any ecosystem-level database work proceeds.** If they are the same table, clinical notes and payment-booking records are currently being written into one undifferentiated store.

---

## 3. Identity is not shared at all

CareHub's login (`businesses`/`staff` plaintext-equality match, cached to `localStorage`) and CareFind's login (real Supabase Auth) are entirely independent systems. There is no code path anywhere that maps a CareHub `staff.id` to a CareFind `auth.users.id` except *through* the `staff_claims` workflow above — which is opt-in, per-person, and requires the CareFind user to already know which CareHub staff record is theirs. A CareHub business owner has no CareFind account by default; a CareFind user has no CareHub account by default. The "one ecosystem" the two products are meant to form has, in the surfaces inspected, two independent identity systems meeting only at the table level.

---

## 4. Recommendation, stated once here since it applies to the whole relationship

Treat `staff_claims` as the reference pattern. Both `business_claims`'s one-directional write and the `products` marketplace-column gap would benefit from being brought up to that same standard: a documented, two-sided contract that both teams know about and test against — rather than the current state, where CareFind depends on CareHub-shaped data CareHub doesn't know it needs to keep providing, and CareHub's admin/product screens have no visibility into what CareFind does with (or writes to) their shared tables.
