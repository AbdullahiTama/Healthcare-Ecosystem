# CareHub Schema Reference

This is the schema document CareHub has never had (H6 in `Technical-Debt.md`: "no schema, migration, or ERD exists for either product"). It is **reconstructed entirely from source** — every table/column below comes from a query string or a `JSON.stringify(...)` payload in `apps/carehub/src/lib/supabase.js` (now the single consolidated data-access module, after folding in the three hospital shadow services), cross-referenced against the calling page component where a full write payload lives there instead. It is not a live schema dump — no database console access was available while writing it. Treat every column list as "confirmed present as of this read," not "the complete set of columns on the table" — Postgres tables commonly have columns no query in this codebase ever touches.

**Confidence key** used throughout:
- **Confirmed (write)** — seen directly in a `JSON.stringify({...})` payload in `lib/supabase.js` or the calling page.
- **Confirmed (read)** — seen in a `.field` access on a fetched row, but never in a write payload (may be server-managed, e.g. `id`/`created_at`, or genuinely write-elsewhere).
- **Inferred** — column's existence assumed from a `?column=eq.value` filter or `order=column.asc` clause, not from a write or a `.field` read.

---

## 1. Tenancy & Identity

### `businesses`
Root tenant table — every other CareHub table is scoped to a row here via `business_id`. Also doubles as the platform-admin account (`is_platform_admin`, added in this engagement's Phase 0) and multi-branch parent/child (`parent_business_id`, added for the `Locations`/enterprise vertical).

| Column | Confidence | Source |
|---|---|---|
| `id` | Confirmed (read) | PK, referenced everywhere as `business_id` |
| `name` | Confirmed (write) | `Register.jsx` |
| `owner` | Confirmed (write) | `Register.jsx` — `"${firstName} ${lastName}"` |
| `email` | Confirmed (write) | `Register.jsx`, `Login.jsx` (auth) |
| `password` | Confirmed (write) | `Register.jsx` — plaintext, see `Authentication.md` §1 |
| `phone`, `whatsapp`, `address`, `state`, `city`, `hours`, `maps_link`, `lat`, `lng`, `website` | Confirmed (write) | `Register.jsx` |
| `business_type` | Confirmed (write) | `Register.jsx` — drives `lib/permissions.js`'s `getNavItems` business-type branching |
| `status` | Confirmed (write/read) | `'pending'` \| `'active'` \| `'suspended'`, set by `Register.jsx`/`AdminDashboard.jsx`, checked by `Login.jsx` |
| `visible_on_carefind` | Confirmed (write) | `Register.jsx` — the CareHub↔CareFind visibility bridge, see `Shared-Services.md` |
| `plan` | Confirmed (write) | `Register.jsx`, always `'basic'` — no billing enforcement anywhere (`Technical-Debt.md` M13) |
| `is_platform_admin` | Confirmed (write/read) | Added this engagement (Phase 0) — `Login.jsx` checks it before the plaintext branch |
| `parent_business_id` | Confirmed (read) | `getBranches`/`getAllLocations` — multi-branch hierarchy, no confirmed write path found in this pass (branch creation flow not re-traced here — see `knowledge/modules/locations.md`) |

### `staff`
| Column | Confidence | Source |
|---|---|---|
| `id` | Confirmed (read) | PK |
| `business_id` | Confirmed (write/read) | Every `staff` query |
| `email`, `password` | Confirmed (write) | `Staff.jsx` (not re-traced this pass — see `knowledge/modules/staff-management.md`), compared plaintext in `loginStaff` |
| `status` | Confirmed (read) | `'active'` required by `loginStaff`/`getStaffByEmail` |
| `role` | Confirmed (read) | Matched against `lib/permissions.js`'s `ROLES` keys |
| `full_name`, `public_title` | Confirmed (read) | `getStaffClaims`/`getRepAssignments`'s embedded selects |

**Relationships proven via PostgREST embedding** (the only reliable proof of a real FK in a codebase with no schema access): `staff_claims.staff_id → staff.id`, `rep_territories.staff_id → staff.id` (both confirmed in `Database.md`, unchanged by this pass).

---

## 2. Retail Core

| Table | Confirmed columns (write) | Notes |
|---|---|---|
| `products` | `business_id` (via `addProduct({...business_id})`) | **Full form-level column list not re-traced in this pass** — see `knowledge/modules/inventory.md`. **This pass's one confirmed, load-bearing negative finding (resolves H9):** grepped all of `apps/carehub/src` for `image_url`, `sale_type`, `price_unit`, `min_purchase`, `seller_location` — **zero matches anywhere**. `Inventory.jsx`'s `ProductModal` writes `emoji, name, generic_name, cat/category, price, cost_price, stock, reorder_level` and (from `CareFind.jsx`) `list_on_carefind`. CareFind's marketplace-specific product columns have **no write path anywhere in CareHub, confirmed exhaustively, not just "not found in the one file previously checked."** |
| `sales` | `business_id`, `is_on_hold`, `is_credit` (inferred from filters) | Full line-item structure not re-traced — see `knowledge/modules/point-of-sale.md`. This is also where `Technical-Debt.md` C5 (stock never decrements on sale) lives. |
| `clients` | `business_id`, `full_name` | — |
| `expenses` | `business_id` | — |
| `appointments` | `business_id`, `date` (inferred, order clause) | — |
| `debts` | `business_id` | — |
| `purchases` | `business_id` | — |
| `business_settings` | `business_id` | One row per business (`getSettings` takes `r[0]`) |
| `admin_team` | none confirmed this pass | CareHub's own internal admin roster — distinct from CareFind's `admin_teams`/`admin_users`, see `Shared-Services.md` |

---

## 3. Hospital Clinical Pipeline

| Table | Confirmed columns (write) | Notes |
|---|---|---|
| `patients` | `business_id` | Full intake form not re-traced — see `knowledge/modules/patient.md` |
| `triage` | `patient_id` (inferred, filter) | One row per patient (`getTriage` takes `r[0]`) |
| `consultations` | none confirmed this pass beyond insert | **See the `consultations` collision note below — do not treat this table in isolation from CareFind's `consultations`.** |
| `prescriptions` | `business_id` | — |
| `lab_requests` | `business_id` (read), `lab_request_id`-referencing `lab_results` (inferred FK) | Moved into `lib/supabase.js` this session (H1) — was previously duplicated across Doctor.jsx/Lab.jsx |
| `lab_results` | none confirmed this pass beyond `lab_request_id` | `getLabResults` is dead code — never called (`Technical-Debt.md` L3) |
| `imaging_requests` | `business_id` | — |
| `patient_messages` | `patient_id` (inferred, filter) | Triplicated identically across Doctor/Lab/Imaging before this session's H1 fix |

**⚠ `consultations` — the ecosystem's single highest-priority open schema question.** CareHub's `consultations` (this table) is written by `Doctor.jsx` as a clinical record. CareFind's `ProfessionalMonetization.jsx` also writes to a table named `consultations` — a paid-booking record, entirely different shape (`professional_id, patient_id, type, fee, status`). Both products are confirmed to share one physical Postgres project (`Shared-Services.md`), which rules out "two separate tables that happen to share a name." This is very likely one physical table serving two irreconcilable purposes. **Nothing in this pass changes that finding — it's restated here because a schema reference is exactly the artifact that would normally answer this, and it can't, because the answer requires live-schema access this engagement never had.**

---

## 4. Enterprise Vertical (Manufacturer/Importer/Wholesale)

This is the part of the schema most visibly built by a different hand than the retail/hospital core (see `Technical-Debt.md` H7, `Service-Catalog.md`'s note on the `readAuth()` shadow service) — function-expression style throughout, and several tables have their full row shape written explicitly in `lib/supabase.js` rather than left to the calling page, which is unusual relative to every other domain in this file.

### `enterprise_locations`
`business_id` (write/read). No other columns confirmed this pass — see `knowledge/modules/warehouses.md`.

### `territories` / `rep_territories`
`territories`: `business_id`. `rep_territories`: `staff_id`, `territory_id` (both confirmed, `assignRepToTerritory`) — **proven FK to `staff.id`** via embedding (`staff:staff_id(...)`).

### `internal_messages` / `internal_message_recipients` / `internal_message_files` (+ `message-files` Storage bucket)
- `internal_messages`: `business_id`, `parent_id` (self-referential, threading — inferred from `or=(id.eq.X,parent_id.eq.X)`), `subject`, `sender_name` (confirmed, `sendMessage`).
- `internal_message_recipients`: `message_id` (confirmed, FK to `internal_messages.id`, not proven via embed — inferred only), plus whatever fields `Messages.jsx` puts in its `recipients` array (not re-traced this pass), `read_at`.
- `internal_message_files`: `message_id` (same caveat), plus whatever `Messages.jsx`'s `files` array contains.

### `stock_batches` / `stock_movements`
Both have their full row shape visible directly in `transferStock`/`adjustStock` (lines 338–390 of `lib/supabase.js`) — the richest column detail of any table in this document, no cross-referencing needed:

`stock_batches`: `business_id`, `location_id`, `product_id`, `product_name`, `batch_number`, `quantity`, `expiry_date`, `date_received`, `supplier_source`, `storage_location`, `status`, `received_by`.

`stock_movements`: `business_id`, `batch_id`, `from_location_id`, `to_location_id`, `movement_type` (`'transfer'` \| `'adjustment'`), `quantity`, `reason`, `moved_by`.

### `orders` / `order_items` / `order_watchers` / `order_files` / `order_events` (+ `order-files` Storage bucket)
- `orders`: `business_id`, `customer_name`, `created_by_name`, `created_by_staff_id`, `approver_staff_id`, `status` (state machine: submitted → approved/rejected → processing → dispatched → delivered, driven by `advanceOrder`'s `labels` map).
- `order_items`/`order_watchers`/`order_files`: each confirmed to carry `order_id` (FK, inferred not proven), remaining shape set by the caller (`createOrder`'s `items`/`watchers`/`files` args) — not re-traced to the page component in this pass.
- `order_events`: `order_id`, `event_type`, `note`, `actor_name` — an audit trail, fully visible in `addOrderEvent`'s call sites.

### `activity_fields` / `activity_default_viewers` / `field_activities` / `activity_viewers` / `activity_reactions` / `activity_comments` (+ `activity-voice` Storage bucket)
- `activity_fields`: `business_id`, `sort_order` (inferred, order clause) — company-defined custom fields for what a rep logs.
- `activity_default_viewers`: `business_id`, `staff_id`, `viewer_staff_id`, `viewer_name` — fully visible in `setDefaultViewers`.
- `field_activities`: `business_id`, `rep_name`, `location_label` — visible in `logActivity`; GPS/photo/voice fields not re-traced this pass.
- `activity_viewers`: `activity_id` (FK, inferred) + whatever `logActivity`'s `viewers` array contains.
- `activity_reactions`: `activity_id`, `staff_id`, `actor_name` — fully visible in `reactToActivity`.
- `activity_comments`: `activity_id` (inferred FK), `staff_id`, `actor_name`, `body` — visible in `commentOnActivity`.

---

## 5. Cross-Cutting: Notifications

### `staff_notifications`
Fully visible in `notify()`: `business_id`, `staff_id` (nullable), `is_owner` (boolean — true for the owner's copy, false + `staff_id` set for a specific staff member's), `kind`, `title`, `body`, `link`, `read_at`.

**This is the one table in this document where the schema reference directly explains a security decision made elsewhere in this engagement**: `apps/carehub/sql/phase2_rls_pilot.sql`'s bespoke `staff_notifications` policy (branching on `is_owner`/`staff_id` rather than just `business_id`) exists *because* this table's actual shape — confirmed here — has a per-recipient dimension a plain tenant-scoped policy would have missed.

---

## 6. Storage Buckets

| Bucket | Written by | Access |
|---|---|---|
| `message-files` | `uploadMessageFile` | Public (per `Security-Risks.md` Finding #6) |
| `order-files` | `uploadOrderFile` | Public |
| `activity-voice` | `uploadActivityVoice` | Public |

---

## 7. What This Document Does Not Cover

- **Exact column types** (uuid vs bigint, text vs varchar, nullability) — not visible from query strings or JS payloads at all; `apps/carehub/sql/phase2_rls_pilot.sql` flags this same gap for the tables its RLS policies touch.
- **Full form-level column lists** for `products`, `patients`, `sales`, `staff` (beyond what's listed above) — these live in the page components (`Inventory.jsx`, `Reception.jsx`/`Triage.jsx`/`Doctor.jsx`, `POS.jsx`, `Staff.jsx`) and were already traced at that level of detail in this engagement's earlier `knowledge/modules/*.md` deep-dives; re-deriving them here would duplicate that work rather than add to it.
- **CareFind's ~40 tables** — out of scope for this pass; `Database.md` has CareFind's table inventory at the same reconstructed-from-queries confidence level this document uses for CareHub.
- **Indexes, constraints, defaults** — genuinely unknowable without live database access.

**If this document and the live Supabase schema ever disagree, the live schema is correct and this document is stale** — it was built by reading application code on one date, not by introspecting the database.
