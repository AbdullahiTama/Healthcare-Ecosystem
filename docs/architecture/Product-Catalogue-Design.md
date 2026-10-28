# Product Catalogue: Review and Design

Status: approved 2026-10-27. **Phases 1 and 2 are built** (sections 6 and 7); phases 3–5 are not started.

## 1. Review (live data, 2026-10-27)

| Area | Finding |
|---|---|
| Master Catalog page | 2 master products in the whole system. Branches are matched to master products **by name**, so a rename breaks the link. A new branch is seeded by a browser loop over the master list. |
| Business products | 11,348 products across 13 businesses, all typed by hand; 6,109 distinct names. |
| Duplicates | 3,021 product names exist at more than one business with no shared identity ("Neurotex Forte" / "NEUROTEX FORTE" / "neurotex forte"). |
| Completeness | Generic name 10%, barcode 28%, cost price 88%, expiry 1.5%, image 0%, description 0%. 1,161 products have no price. |
| Categories | Free text: "Medicines" holds 60%; there are misspellings ("ANAGELSIC") and ALL-CAPS variants. |
| CareFind exposure | 11,336 of 11,348 products are public, including antibiotics and injections. Prescription-only medicines are advertised with prices: a regulatory risk. |
| Moving stock | Within a business: warehouse-to-warehouse batch transfer exists (`transfer_stock_batch`, atomic). Between branches: none. |

## 2. Goals (owner's decisions)

1. The **business master catalogue** is the one home of a business's products. Branches carry items from it and
   stock moves between branches and within a branch (warehouses, shelves) against the same item.
2. A **shared CareHub product library** at platform level. Business master items link to it. It is filled from our
   own data with admin review, plus an official list (NAFDAC registered products) when one is provided. Businesses
   can suggest new entries, which admins approve.
3. **Prescription-only safety:** on CareFind, prescription-only medicines show availability only: no price and no
   online ordering.
4. **Catalogue health:** a score for each business, merging duplicates, standard categories, flags for missing
   data, and no unpriced items on CareFind.

## 3. Model

Three layers, each linking to the one above by id, never by name:

```
platform  catalog_items          (shared library: one row per real product, curated)
             ▲ catalog_item_id (optional)
business  master_products        (the business's own list: its names, default price, category)
             ▲ master_product_id
branch    products               (what a location sells: stock, branch price, shelf, batches)
```

### 3.1 `catalog_items` (new, platform)

A curated product. Its fields:
- `brand_name` and `generic_name` (INN);
- `strength`, `dose_form` and `pack_size`;
- `manufacturer` and `nafdac_no`;
- `barcodes` (text[]);
- `category_code`, from the standard taxonomy below;
- `rx_status`: `otc`, `pharmacy_only`, `prescription_only` or `controlled`;
- `image_url` and `description`;
- `status`: `active`, `pending` (suggested) or `retired`;
- `source`: `seeded`, `nafdac_import` or `suggested`;
- `verified_by` and `verified_at`.

Readable by everyone, including CareFind. Written only by platform admins, through a review queue.
`catalog_suggestions` holds what businesses propose. Each suggestion keeps the business's own master item usable
straight away; an approval links it.

### 3.2 `master_products` (existing, extended)

New columns:
- `catalog_item_id`;
- `generic_name`, `strength`, `dose_form` and `pack_size` (copied from the library when linked, editable while
  unlinked);
- `barcode` and `category_code`;
- `rx_status`, defaulting from the library;
- `default_cost` and `reorder_level`;
- `archived_at`.

A unique index on `(business_id, normalised name + strength)` stops duplicates inside a business.

### 3.3 `products` (existing, extended)

New columns:
- `master_product_id`: every product of a business with a master catalogue points at its master item;
- `rx_status`, mirrored from the master item for fast CareFind filtering.

Branch-local fields stay on the product: stock, branch price override, shelf, batches and reorder level.

**Migration of today's data:** for each business, a master item is created per distinct normalised product name
across its locations, and each `products` row is linked to it. Nothing is deleted, and staff see no difference
except that duplicates can now be merged.

### 3.4 Moving stock

| Move | How |
|---|---|
| Within a branch | Existing `transfer_stock_batch` between that branch's warehouses, plus a shelf change, which is an edit. Unchanged. |
| Between branches | New `stock_transfers` (header: from branch, to branch, status `draft` → `sent` → `received` / `cancelled`, notes, who and when) and `stock_transfer_lines` (master item, batch, qty sent, qty received). |

The functions behind a branch transfer:
- `send_stock_transfer` deducts stock (and batches) at the source and puts it in transit.
- `receive_stock_transfer` adds it at the destination, creating that branch's product from the master item if the
  branch did not carry it yet, and records any shortfall.
- `cancel_stock_transfer` returns in-transit stock to the source.

All three are atomic and members only, and they write stock movements on both sides so stock history and
valuation stay correct.

### 3.5 Branch carrying (replaces name matching)

- `carry_master_items(branch_id, master_ids[], price_override?)` creates or reactivates the branch's products from
  master items in one call. It replaces the browser loop in `cloneBranchData` and the name-matched
  `activate_branch_product`.
- **Push** updates name, category, generic, Rx status and default price at every carrying branch, by id. A branch
  price override is kept.
- `branch_products` is folded into `products.master_product_id` plus `products.active`, so there is one source of
  truth.

### 3.6 Prescription-only safety

- `rx_status` comes from the library. A master item without a library link defaults to `prescription_only` when
  its category is, for example, antibiotics or injections, and the owner can change it.
- CareFind (search, business profile, shop):
  - `prescription_only` and `controlled` items show **"Available: ask the pharmacist"**, with no price and no
    add-to-cart;
  - the database view or RPC that serves CareFind enforces this, not only the UI;
  - online orders refuse these items server-side.

### 3.7 Catalogue health

- A standard category taxonomy, about 25 codes (analgesics, antibiotics, antimalarials, antihypertensives,
  antidiabetics, vitamins and supplements, cough and cold, eye, ear and nose, skin, injections and infusions,
  devices and consumables, mother and baby, personal care, general retail…). Existing free-text categories are
  mapped with a reviewed lookup table, so "ANAGELSIC" and "ANALGESIC" both become `analgesics`.
- `catalogue_health(business_id)` reports a score and counts: no price, no generic, no barcode, unlinked to the
  library, possible duplicates, no category, and Rx items publicly priced.
- Fix-it tools: merge duplicates (stock and history move to the kept item), bulk-set categories, link to library
  suggestions (by barcode, then by normalised name and strength, which the owner confirms), and hide unpriced
  items from CareFind.

## 4. Phases

Each phase is shippable, keeps today's workflows working, and has its own migration and tests.

| Phase | Delivers | Depends on |
|---|---|---|
| **1. Foundation** | Standard categories and mapping; `rx_status`; master items extended; every product linked to a master item (backfill); carrying by id (`carry_master_items`, push by id); Master Catalog page rebuilt as the main product home (search, filters, bulk carry to branches, per-branch prices) | — |
| **2. Prescription-only safety** | CareFind and online orders enforce availability-only for Rx and controlled items | 1 |
| **3. Moving stock between branches** | Transfers (send, in transit, receive with shortfall, cancel), on the Master Catalog and in each branch's Inventory | 1 |
| **4. Shared library** | `catalog_items`, seeding from clustered business data, admin review queue, NAFDAC list import (CSV/Excel), business suggestions, link suggestions; add a product by search or barcode from the library | 1 |
| **5. Catalogue health** | Score, duplicate merge, bulk category fixes, missing-data flags, CareFind hiding unpriced items | 1, 4 |

## 5. Risks and open points

- **Size:** 11k products for each backfill run. These are set-based SQL migrations, tested on a copy of
  production-shaped data in PGlite.
- **Pending migrations:** three earlier migrations (supplier payments, credit customers, plan enforcement) are not
  applied yet. Each phase here adds one. The SQL Editor route works; the automated approval prompt has not reached
  the owner.
- **NAFDAC list:** needs a file from the owner. Phase 4 imports whatever columns it has.
- **Prescription-only defaults** for unlinked items are a judgement by category. The owner can correct them per
  item.

## 6. Phase 1 as built

### Database (`supabase/migrations/carehub_20261215_catalogue_foundation.sql`)

| Object | What it does |
|---|---|
| `product_categories` | 23 standard groups, each with a default prescription status. Readable by everyone. |
| `category_aliases` | Every category spelling in use (about 130) mapped to a group, for example `ANAGELSIC` → `analgesics`. An alias can set its own status (`PRESCRIPTION` → prescription-only). |
| `category_code_for(text)`, `rx_status_for(text)` | Apply the mapping. Unknown text becomes "Other medicines", pharmacy-only. |
| `master_products` (extended) | Generic name, strength, form, pack size, barcode, `category_code`, `rx_status`, default cost, reorder level, `archived_at`, and a normalised `name_key`. Unique per business while not archived. |
| `products` (extended) | `master_product_id`, `rx_status` (mirrored), `price_source` (`master` follows the master price; `branch` is the location's own price). |
| Backfill | One master item per normalised name per main business: the most common spelling and category, the median price and cost. Every named product is linked and recorded as carried. Re-running changes nothing. |
| `products_link_master` (trigger) | **Auto-add:** a product added at any location, by hand, import or purchase, links to the item of the same name in its main business, creating it if needed. A link to another business's item is refused. |
| `products_price_source` (trigger) | A price typed at a location makes it that location's own price. A price set by Push does not. |
| `carry_master_items(branch, ids[], price?)` | Carries many items at a location in one call. It creates missing products at stock 0 and restarts stopped ones. A given price becomes the location's own price. |
| `activate_branch_product` | Same signature, now by id, through `carry_master_items`. |
| `push_master_product` | Updates every linked product by id: name, generic name, category, barcode and prescription status. The price changes only where the location follows the master price. |
| `master_catalog_page(...)` | One page of items, filtered by search (name, generic name or barcode), category, prescription status and archive state. Each item includes where it is carried, with price, stock, price source and whether it is stopped. |
| `business_root(id)` | The main business of a location. It answers members, platform admins and server code only. |

### App (`apps/carehub/src/modules/master-catalog`)

| File | Role |
|---|---|
| `MasterCatalog.jsx` | The page. Server-side search (with a pause in typing), category and prescription filters, archived view, pages of 50, select and bulk Carry or Archive. Loading, error with retry, and two empty states. Owner only. Adding and carrying are paused on an expired plan. |
| `MasterItemCard.jsx` | One item: its facts, category, prescription status, and a chip per location with price, stock, own price and stopped. A location holding duplicate entries for the item is flagged. |
| `MasterItemForm.jsx` | Add or edit an item with every field. Saving an edit asks the owner to Push. |
| `CarryDialog.jsx` | Carry the selected items at chosen locations. A price is allowed for a single item. |
| `ItemLocationsModal.jsx` | One item at each location: carry, stop carrying, or set the location's own price. |
| `catalogueRules.js` | Prescription labels, form validation and payload, and the per-location summary. |
| `repositories/index.js` | Adds `getPage`, `getCategories`, `carry`, `archive` and `restore`. Each falls back to today's behaviour until the migration is applied. |

The other change is in `locations/repositories`: `cloneBranchData` now carries the whole live catalogue at a new branch
in calls of 500 items, instead of one call per item. CareFind already hides items without stock, so a new branch does
not advertise empty shelves.

Archive replaces delete: a carried item cannot be deleted (`branch_products` has no cascade). Archiving keeps every
location's products, stock and history.

### Security implications

- No permission is widened. The page, carry, push and the page function run as the caller under the existing RLS.
  `carry_master_items` also checks membership of the location, and `push_master_product` checks the business.
- `products_link_master` is SECURITY DEFINER so that staff at a branch, who cannot write the main business's
  catalogue, still get their new product linked. It copies only the new product's own fields. It refuses links to
  another business's item.
- `business_root` is SECURITY DEFINER to walk the business tree. It returns nothing to a signed-in user outside that
  tree.
- Plan limits and restrictions (`carehub_20261214`) still apply to every product created by carry or auto-add, because
  those inserts run as the caller.

### Deployment

The app is safe before the migration: the page shows the plain list with a notice, carrying uses the old one-by-one
call, and the form sends only the original fields. The migration is safe before the app: the old page keeps working,
and every new product is linked automatically.

### Test plan

- **PGlite** `apps/carefind/src/test/catalogue/catalogueFoundation.db.test.js` (24 tests), on the live table shapes,
  policies and `current_business_ids()`:
  - category mapping;
  - the backfill: one item per name across locations, the chosen spelling, median and category, links, price source,
    reuse of an existing item, and re-running;
  - auto-add from branch staff, a second spelling, and refusal of a foreign item;
  - price source;
  - carry: create at stock 0, no duplicates, own price, foreign items ignored, non-members and a zero price refused,
    stop and restart;
  - push by id respecting own prices;
  - the page function's search, filters and archive;
  - `business_root` access.
- **Unit tests:**
  - `catalogueRules.test.js`;
  - the repository tests, including fallbacks before the migration;
  - `cloneBranchData.test.js` (bulk calls, the 1000-row page limit, partial failure, fallback);
  - `MasterCatalog.test.jsx`: list, error with retry, empty, search, bulk carry, push, archive, expired plan, before
    the migration, and owner only.
- **Manual, after applying the migration:**
  1. Open Master Catalog and check that the item count is close to the number of distinct product names.
  2. Filter Antibiotics and check that they are prescription-only.
  3. Carry one item at a branch, then check that the branch's Inventory shows it at stock 0.
  4. Change a branch price in Inventory, push the item, and check that the branch keeps its price.

## 7. Phase 2 as built: prescription-only safety

**Owner's decisions:**
- Prescription-only and controlled medicines show on CareFind as **"Available: ask the pharmacist"**, with no price and
  no online ordering (2026-10-27).
- Shop listings marked "prescription required" are treated the same way (2026-10-28).

**Finding (live, 2026-10-28):**
- 884 prescription-only products were listed on CareFind, and 861 of them showed a price to anyone. Any listed row,
  price included, could be read directly from the products table.
- One shop listing of a prescription-only product could be ordered online, and two "prescription required" listings
  could be ordered too.

### Database (`supabase/migrations/carehub_20261221_prescription_safety.sql`)

| Object | What it does |
|---|---|
| `is_rx_restricted(rx_status)` | True for `prescription_only` and `controlled`. |
| Policy "public can view listed products" | Restricted items are no longer readable from the products table by the public. The business's members, the listing's own seller and an approved claimant still see them in full. |
| View `carefind_products` | The public list of every listed product. Restricted items come with `price` null, `show_price` false and `rx_restricted` true. It omits cost price and lists only listed products. It is owned by the database owner (not security_invoker) so that it can include restricted items without their price. |
| Policy "ecommerce_products public read" and view `shop_public_products` | The shop no longer lists restricted products or "prescription required" listings. |
| Trigger `shop_order_items_no_prescription` | Refuses any order line for a restricted product or a "prescription required" listing, whoever inserts it, so `create_shop_order` fails as a whole with "… is a prescription medicine and is not sold online. Please ask the pharmacist." |

**Previous definitions** (for rollback):
- "public can view listed products": `for select using (list_on_carefind = true)`.
- "ecommerce_products public read": `status = 'Active' and is_restricted = false and is_ecommerce_vendor_approved(business_id)
  and exists (select 1 from products p where p.id = product_id and (p.stock is null or p.stock > 0))`.
- `shop_public_products`: the same columns, without the two prescription conditions.

### App (CareFind)

- `utils/marketplace.js`:
  - `isRxRestricted(product)`;
  - `canShowPrice` never shows a price for a restricted item;
  - `noPriceLabel(product)` returns "Available: ask the pharmacist" for restricted items and "Ask for price" otherwise.
- The search, featured products, drug profile and business profile screens read `carefind_products` (healthcare and
  business-profile repositories) and use `noPriceLabel`. The post composer's product lookup reads the view too.
- Restricted items do not appear in the shop, so they cannot reach the cart or checkout.

### Security implications

- The changes only narrow what the public can read and order.
- `carefind_products` is the one place restricted items are exposed, and only without a price.
- The order-line trigger enforces the rule in the database, so it holds even if a screen is wrong or an API caller
  builds an order by hand.
- Separate finding, not changed here: the public can still read `products.cost_price` of non-restricted listed items
  from the table. CareFind screens no longer need the table, so a later change can move all public reads to
  `carefind_products` and remove the table's public policy.

### Test plan

- **PGlite:** `apps/carefind/src/test/prescription-safety/prescriptionSafety.db.test.js` (9 tests):
  - the public cannot read restricted items from the table;
  - the business, the seller and a claimant still can;
  - the view lists everything, with no price for restricted items and no cost;
  - unlisted items are excluded, and the view is read-only;
  - the shop hides restricted and "prescription required" listings;
  - order lines are refused, and an ordinary line is accepted;
  - re-running the migration is safe.
- **Unit and UI:**
  - `utils/marketplace.test.js`: the price rule and the label;
  - `BusinessProfile.test.jsx`: a restricted item reads "Available: ask the pharmacist" with no price, and comes from
    `carefind_products`.
- **Manual, after applying the migration:**
  1. Search for an antibiotic on CareFind and check that it shows "Available: ask the pharmacist".
  2. Check that the shop no longer lists it.
