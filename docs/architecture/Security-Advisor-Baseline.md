# Supabase security advisor: baseline

2026-11-23. CODE_AUDIT A4. The advisor (Supabase › Advisors › Security, or `get_advisors`) was run, each group was
checked against function bodies, grants and policies, the actionable findings were fixed in
`supabase/migrations/carehub_20270204_security_advisor_a4.sql`, and the rest are recorded below with the reason, so a
later run only needs to be compared against this list.

## Run of 2026-11-23

| Level | Finding | Count | Outcome |
|---|---|---|---|
| ERROR | SECURITY DEFINER views | 2 | Accepted (below) |
| ERROR | RLS disabled in public | 1 | Accepted: `spatial_ref_sys` |
| WARN | Mutable `search_path` | 3 | **Fixed** |
| WARN | Leaked-password protection off | 1 | **Owner step** (dashboard) |
| WARN | Extensions in `public` | 2 | Accepted: `pg_trgm`, `postgis` |
| WARN | anon may execute SECURITY DEFINER functions | 24 | 3 **fixed**, 21 accepted (below) |
| WARN | authenticated may execute SECURITY DEFINER functions | 208 | Reviewed: 1 more **fixed**, 1 follow-up, rest by design |
| INFO | RLS enabled, no policy | 34 | Accepted: deny-all for clients; server-only tables |

## Fixed (carehub_20270204)

| Problem | Effect before | Fix |
|---|---|---|
| **Grant drift.** `REVOKE … FROM PUBLIC` does not remove the EXECUTE Supabase gives `anon` directly on new functions, so functions meant for signed-in users or the server were callable by anyone | see the next rows | Revoke from `anon` and `authenticated` explicitly. **Rule for new migrations:** write `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;` before granting |
| `track_purchase_pattern(order)` callable by anyone, no caller check | "Frequently bought together" could be inflated for any order, repeatedly | Server only (the payment server calls it once an order is paid) |
| `auto_generate_recommendations(product)` callable by anyone | Anyone could create product links | Server only (nothing calls it today) |
| `track_product_view(product, user, session)` stored the user id passed in | Anyone could write views under another customer's id | Records the caller's own id (`auth.uid()`); the passed id is ignored |
| `shop_product_views_select` was `true` for every signed-in user | Any user could read which customer viewed which product (browsing history on a health marketplace) | Each user reads only their own views; the admin screen reads through the server |
| `get_admin_shop_overview()` had no caller check | Any signed-in user could read marketplace revenue, commission, order and customer counts | Server only (the admin console calls it through `admin-auth`) |
| `create_shop_order` (19-argument wrapper), `shop_order_receipts_guard`, `plan_enforcement_started_at` without a pinned `search_path` | Name resolution could follow the caller's path | `SET search_path = public, pg_temp` (none uses the `extensions` schema) |
| `notify_stock_alerts_on_restock()` (a trigger function) executable by API roles | No direct effect | EXECUTE revoked (the trigger still fires) |

The CareFind client stopped calling `track_purchase_pattern` and `auto_generate_recommendations` (both unused) and no
longer sends a user id to `track_product_view`.

## Accepted, with reasons

**SECURITY DEFINER views**

* `carefind_products`: the public product list. It must be readable by logged-out visitors, but a `security_invoker`
  view would apply the `products` policies, and one of them calls `is_platform_admin()`, which `anon` may not execute,
  so every anonymous read would fail (verified 2026-11-22). The view itself is the boundary: listed and priced products
  only, prescription prices masked, no cost price.
* `adr_pv_case_view`: column masking for pharmacovigilance cases (ADR-Privacy-Security-Audit.md).

**`spatial_ref_sys` without RLS:** PostGIS reference data (coordinate systems), owned by the extension; nothing
private.

**`pg_trgm` and `postgis` in `public`:** moving them would change every function and index that uses them, for no
security gain here.

**anon-executable SECURITY DEFINER functions (21)**

| Function | Why it is public |
|---|---|
| `register_business` | Sign-up |
| `get_staff_invitation`, `accept_staff_invitation` | Staff invitation link (needs the secret token) |
| `get_tracking_by_token` | Order tracking link (needs the secret token) |
| `calculate_delivery_fee`, `calculate_shop_commission`, `calculate_shop_delivery_fee`, `calculate_shop_fulfilment_fee` | Prices shown at checkout; no data read except public delivery zones |
| `get_product_recommendations` | Active, unrestricted shop listings only (its user id argument is unused) |
| `get_vendor_rating_stats` | Public rating summary |
| `is_ecommerce_vendor_approved`, `is_ecommerce_image_vendor_approved` | Yes/no answers used by storage and row policies for public product images |
| `track_product_view` | Shop pages record views for signed-out visitors (now under no user id) |
| `record_post_view` | Feed view counts; checks its session |
| `add_tracking_event`, `set_default_address` | Check the caller; anon is refused |
| `current_business_ids`, `get_my_admin_info` | Return nothing for anon; used by policies |
| `st_estimatedextent` (3) | PostGIS |

**authenticated-executable SECURITY DEFINER functions (208):** every one that writes was checked. All check their
caller directly (`auth.uid()`, `current_business_ids`, `is_business_owner`…) or through a helper (`catalog_require_*`,
`hospital_can`, `rep_ledger_require`, `can_*`), except the ones fixed above and `register_business` (sign-up). Those that
only read were checked the same way. The two without a check were `get_admin_shop_overview` (fixed) and
`adr_icsr_missing` (follow-up).

## Follow-up

* `adr_icsr_missing(report)` reads any ADR report as the owner and returns which required fields are empty (not their
  values). Revoking it would break `submit_adr_report`, which runs as the user and calls it. An access check must also
  allow `submit_adr_public_report`'s anonymous path. Low: the caller must already hold the report's random id.

## Owner step

**Leaked-password protection:** in the Supabase dashboard, under Authentication's password / attack-protection
settings, turn on the option to prevent the use of leaked passwords (it checks new passwords against HaveIBeenPwned).
The advisor finding links to the exact page. It cannot be set through SQL.

## Tests

`apps/carefind/src/test/security/securityAdvisorA4.db.test.js` (PGlite, starting from the live bodies and the drifted
grants): before, anyone inflates purchase patterns and records views under another id, and users read others' views.
After: those functions are server-only, views are recorded under the caller, browsing history is private, the restock
trigger still fires for ordinary users, `search_path` is pinned and the append-only guard still guards, marketplace
totals are server-only, and the migration is idempotent.
