# Product Catalogue: Review and Design

Status: approved 2026-10-27. **Phases 1–4 are built** (sections 6–9); phase 5 is not started.

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
| **5. Catalogue health** | Score, duplicate merge, bulk category fixes, missing-data flags, CareFind hiding unpriced items (built and live, §10) | 1, 4 |

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

## 8. Phase 3 as built: moving stock between branches

**Owner's decision (2026-10-27):** the owner and managers send stock; any staff member of the receiving location
receives it.

**Finding:** a `stock_transfers` table already existed (carehub_20260810). It had 0 rows, no app code and one product
per row, and its only policy (FOR ALL, without WITH CHECK) let any member write rows directly. It is extended rather
than replaced.

### Database (`supabase/migrations/carehub_20261222_branch_stock_transfers.sql`)

| Object | What it does |
|---|---|
| `stock_transfers` (extended) | The transfer: number (`TRF-YYMMDD-XXXXX`), from and to location, main business, status `in_transit` → `received` or `cancelled`, and who sent, received or cancelled it and when, with notes. The old single-product columns are now optional and unused. |
| `stock_transfer_lines` | One row per master item: quantity sent, quantity received, the product at each end, and unit cost. |
| `send_stock_transfer(from, to, lines, note)` | Owner or manager of the sending location (`is_business_manager`), with both locations in the same business. For each item, the sending location's product is locked, its stock checked and reduced at once, and a ledger movement (`branch_transfer_out`) written. The receiving location's owner is notified. Up to 200 items, and an item may not be listed twice. |
| `receive_stock_transfer(transfer, lines, note)` | Any staff member of the receiving location. Lines left out arrived in full; any other line records what arrived (from 0 to what was sent). Stock is added to the receiving location's product. If that location did not carry the item, the product is created from the master item at the master price. Movements are recorded as `branch_transfer_in`. A shortfall is recorded on the line and the sender is notified. |
| `cancel_stock_transfer(transfer, reason)` | Owner or manager of the sending location, while still in transit. Every item returns to the sending product (`branch_transfer_cancel`). |
| Policies | Read-only: both locations, and the owner above them, see a transfer and its lines. Direct inserts, updates and deletes are refused; only the three functions change transfers. |

Every function is atomic: an error anywhere leaves both locations' stock unchanged.

### App (`apps/carehub/src/modules/transfers`)

- **Stock Transfers page** (`StockTransfers.jsx`), in the Operations menu for every built-in role. Custom roles need
  the owner to tick it.
  - It lists the transfers in and out of the current location, with filters (All, Incoming, Outgoing, In transit) and a
    banner counting transfers waiting to be received.
  - It handles loading, error with retry, not installed, a single location, and filtered and empty lists.
- **New transfer** (`NewTransferModal.jsx`): choose the receiving location, search this location's stock (items linked
  to the master catalogue and in stock), and enter quantities. Quantities are checked against the stock here before
  sending.
- **Transfer details** (`TransferDetailModal.jsx`): items with sent and received quantities, and who did what.
  - The receiving location enters what arrived; empty means all of it arrived.
  - The sending location's owner or a manager can cancel, after confirming, while the transfer is in transit.
- **Shortcut:** the Master Catalog has a "Stock transfers" button when the business has more than one location.
- The database's refusal is shown as written ("Only 10 of Paracetamol in stock at Ikeja."), and anything else as a
  plain retry message.

### Security implications

- The three functions are SECURITY DEFINER because a transfer changes stock in two locations. Each checks the caller
  itself: a sending-location manager, or a receiving-location member. Both locations must belong to the same main
  business.
- Quantities and stock are validated in the database with row locks, so two people cannot send the same stock twice.
- The direct write access the old policy allowed is removed.
- The page only offers Send and Cancel to owners and managers. The database is the boundary.

### Test plan

- **PGlite:** `apps/carefind/src/test/stock-transfers/branchStockTransfers.db.test.js` (9 tests):
  - a manager sends: stock leaves at once, with lines, ledger and notification;
  - refusals: a cashier, more than in stock, an item not carried, another business, the same location, zero, and
    duplicate lines;
  - no direct writes;
  - any staff member receives, with a shortfall recorded and the sender told;
  - an item the receiving location did not carry is created from the master item;
  - a transfer cannot be received twice or cancelled once received;
  - a received quantity above what was sent is refused;
  - a cancel returns the stock, and only a sending-location manager can cancel;
  - visibility to both locations and the owner, but not another business;
  - re-running the migration is safe.
- **Unit and UI:**
  - `transfers/__tests__/transferRules.test.js`: the rules and the repository's calls;
  - `transfers/__tests__/StockTransfers.test.jsx`: list and filters; a cashier receives with a shortfall; a manager
    sends; too much is stopped before sending; cancel; error and not-installed states.
- **Manual, after applying the migration:**
  1. Send a few units of an item from one branch to another. The sending branch's stock drops at once.
  2. Receive the transfer at the other branch, entering one unit short. That branch's stock rises, and the sender sees
     the shortfall.

## 9. Phase 4 as built: the shared CareHub product library

**Finding (live, 2026-10-28):** 11,323 master items at 12 businesses. 3,021 normalised names are used by two or more
businesses (1,735 by three or more); 1,490 barcodes are shared. No item has its own strength: it is part of the name.

### Database (`supabase/migrations/carehub_20261223_shared_product_library.sql`)

**Applied to live 2026-11-16**, with the follow-up `carehub_20261224_catalog_items_anon_read.sql`. Verified on live:
27 functions, 9 indexes, 3 triggers, RLS and 3 policies, `master_products.catalog_item_id`; seeding added
**2,106 pending candidates** (fewer than the 3,000 estimated in October because live has 10,237 items now); the old
`master_catalog_page` call still works; anon, businesses and links have no write access.

**Follow-up (`carehub_20261224`):** the original read policy on `catalog_items` called `is_platform_admin()` for anon
too. anon may not execute that function (security remediation, see `carefind_20261003`), so every logged-out read
of the library, `catalog_search` included, failed with "permission denied" instead of returning approved items. The
policy is now split like `carefind_20261003`: anon reads approved items only; signed-in users read approved items,
and admins everything. The PGlite test now revokes the function from anon, as live, so this is covered.

| Object | What it does |
|---|---|
| `catalog_items` | The library: name, strength, generic name, form, pack size, manufacturer, NAFDAC number, barcodes, category, prescription status, description, `status` (`pending`, `active`, `retired`) and `source` (`seeded`, `nafdac_import`, `suggested`, `admin`). `match_key` (name + strength, lower case, a number joined to its unit) is unique among items that are not retired; so is the NAFDAC number, compared without spaces or hyphens. |
| `catalog_suggestions` | A business's proposal, a snapshot of one of its master items, with a note. One pending suggestion per item. Status `pending` → `approved`, `rejected` or `withdrawn`. |
| `master_products.catalog_item_id` | The link. Linking fills the item's empty fields from the library (generic name, strength, form, pack size, barcode, category, description); the name and prices stay the business's. Only approved items can be linked. |
| Trigger `master_products_library` | A linked item's prescription status is never less strict than the library's: a lower value is raised on every write. |
| Trigger `catalog_items_raise_rx` | When an admin makes a library item stricter, every linked master item is raised and its location products follow (`catalog_mirror_products`). A looser library status changes nothing at businesses. |
| Seeding (`catalog_seed_candidates`, run by the migration) | Every name used by two or more businesses becomes a **pending** item: the most common spelling (on a tie, the least capitalised), generic name and category, the most common prescription status (a tie goes to the stricter one), and the ten most used barcodes. A retired name is never seeded again. About 3,000 candidates on live data. |
| `catalog_search(q)` | Approved items by barcode (exact), name or generic name; best first. Readable by everyone. |
| `catalog_link_matches(business)` | The business's unlinked items that match an approved item: by barcode first, then by name and strength. |
| `link_master_to_catalog`, `unlink_master_from_catalog`, `suggest_catalog_item` | Owner or manager of the main business (`is_business_manager`). Linking withdraws a pending suggestion for the item; unlinking keeps the item's details and status. |
| `admin_catalog_page`, `admin_save_catalog_item`, `admin_review_catalog_items` (approve, retire, reopen; up to 500), `admin_merge_catalog_items`, `admin_import_catalog_items` (up to 1000 rows a call), `admin_seed_catalog_candidates`, `admin_catalog_suggestions`, `admin_decide_catalog_suggestion` (create, link, reject) | CareHub admins only (`is_platform_admin`). Retiring unlinks business items. Merging moves links and suggestions to the kept (approved) item, which gains the other's barcodes and missing details, and retires the other. Deciding a suggestion links the business's item and notifies its owner (`staff_notifications`). |
| `master_catalog_page` | Gains `p_library` (`linked` / `unlinked`); each item now includes `library` (its library entry) and `suggestion` (its latest suggestion). |

**Import rules (official list):** a row is matched by NAFDAC number, then by name and strength. A match gets the row's
details where it has none, its barcodes, a stricter prescription status if the row has one, and is approved; anything
else is added, approved. Rows without a name are skipped and reported. Prescription classes are read as written:
`POM`/`Rx` → prescription only, `P` → pharmacy only, `OTC`/`GSL` → over the counter, `CD` → controlled.

### App

- **Admin: Trust → Product Library** (`pages/admin/trust/ProductLibrary.jsx`, `modules/product-library/admin`):
  - **Review queue:** candidates, most widely used first, with search and source filter; approve, edit or retire one
    item or a selection; "Find new candidates" seeds again.
  - **Suggestions:** from which business and who; an existing library item with the same name or barcode is shown,
    with one-click Link. Otherwise "Add to library…" (details editable first), "Link to another item…" or "Reject…"
    with a reason.
  - **Approved** and **Retired:** browse, edit, add, retire, reopen. Editing offers "merge into another item" for
    duplicates.
  - **Import list:** a .xlsx or .csv of any shape. The columns are recognised from their headings (product name,
    generic, strength, form, pack, manufacturer, NAFDAC number, barcode, category, prescription class) and can be
    changed; the first rows are previewed; rows go in batches of 500 with progress and Stop; the result lists added,
    matched and skipped rows.
- **Business: Master Catalog** (owner):
  - a banner counting items that match the library, opening **Review matches**: tick and link in bulk, with the
    reason for each match and any prescription status that will rise;
  - a "CareHub library" badge on linked items and a **Library** button on each item: see the link and unlink, find
    and link a library item, or suggest the item (with a note), and see a suggestion's outcome;
  - a linked / not linked filter;
  - **+ Add item** can start from a library search: details fill in, the item is linked, and the prescription status
    list starts at the library's.
  - Everything library-related is hidden until the migration is applied.
- Shared pieces: `lib/spreadsheet.js` (CSV and Excel reading, now also used by the business directory import),
  `lib/dbErrors.refusalMessage` (a database function's refusal as a sentence, now also used by transfers),
  `modules/product-library` (repository, rules, `LibrarySearch`).

### Security implications

- No permission is widened. The library is read-only to the public and to businesses, and only approved items are
  visible to them. Pending, retired and reviewer details are admin-only.
- Read policies are per role (`carehub_20261224`): the anon policy never calls `is_platform_admin()`, which anon may
  not execute. No function grant was added to make it work.
- All writes go through SECURITY DEFINER functions that check the caller first: platform admin for the library,
  owner or manager of that main business for links and suggestions. Direct writes to both tables are revoked, admins
  included.
- Prescription status only becomes stricter automatically. A business can never link its way to a looser status;
  only a deliberate owner Push can lower a location product, and only an unlinked item can be set looser than the
  library.
- A suggestion stores the suggester's email for review; it is visible to admins and to that business only.

### Test plan

- **PGlite:** `apps/carefind/src/test/catalogue/sharedProductLibrary.db.test.js` (26 tests, on the phase 1 migration,
  the live shapes and anon without `is_platform_admin()`):
  - matching key; seeding (two or more businesses, chosen spelling, most common details, stricter tie, barcodes;
    re-seeding adds nothing; retired names stay out);
  - who can read, and that nobody writes the tables directly; admin functions refuse others;
  - review: page and search, bulk approve, search by name / generic / barcode, save and duplicate refusal, reopen;
  - links: matches by barcode then name; a cashier and another business are refused; empty fields fill; location
    products follow; pending items cannot be linked; the prescription floor; unlink keeps details; stricter library
    status reaches businesses and a looser one does not; adding straight from the library; the page's filter and
    library details;
  - suggestions: once only, linked items and outsiders refused; create, link, reject with notifications; linking
    withdraws a pending suggestion;
  - import: add, match by NAFDAC number in another format, fill in, approve, raise the prescription status, skip rows
    without a name, the 1000-row limit;
  - merge and retire; re-running the migration.
- **Unit and UI (CareHub):** `product-library/__tests__/libraryRules.test.js` (labels, form, column guessing, row
  mapping, batches, repository and fallbacks); `ProductLibrary.admin.test.jsx` (queue, bulk approve, retire with
  confirmation, seed, error and not-installed states, add with refusal, suggestions create / link / reject, CSV import
  and the missing-name check); `master-catalog/__tests__/MasterCatalog.test.jsx` (hidden before the migration, badge,
  filter, bulk matches, link and suggest one item, refusal shown, unlink, add from the library with the status floor);
  `catalogueRules.test.js` (status floor and form fill).
- **Manual, after applying the migration:**
  1. Admin → Trust → Product Library: the review queue holds about 3,000 candidates. Approve a few common ones.
  2. Master Catalog (as an owner): the banner counts matches. Link one and check that its prescription status and the
     location products follow.
  3. Suggest an unlinked item; approve it as admin; check the owner's notification and the item's library badge.
  4. Import a small official list (.csv) and check the counts.


## 10. Phase 5 as built: catalogue health

**Finding (live, 2026-11-18):** 10,368 current master items. 1,202 have no price, 9,170 no generic name, 6,864 no
barcode, and 7,335 (71%) are in "Other medicines". 1,211 of the 9,828 products listed on CareFind have no price. Exact
duplicate names cannot exist (unique name key), but 3 groups share a barcode, 8 differ only by spaces or punctuation,
and near-identical spellings exist. In the largest catalogue (3,228 items) most trigram matches are size variants
("… b/s" and "… s/s"), so those are not suggested.

**Owner's decisions:** a merge keeps history (stock and batches move through the ledger; the dropped product is
stopped, not deleted). CareFind hides items with no price; prescription-only items stay listed as "ask the
pharmacist".

### Database (`supabase/migrations/carehub_20270127_catalogue_health.sql`)

**Applied to live 2026-11-18**, with the follow-up `carehub_20270128_catalogue_pairs_speed.sql`.

Verified on live:

- **CareFind:** `carefind_products` went from 11,471 to 10,269 rows. That is exactly the 1,202 unpriced items; none is
  left, and 558 prescription-only items are still listed with no price.
- **Permissions:** functions and grants as planned (the write functions are SECURITY DEFINER; nothing is executable by
  anon except the pure helpers). The dismissals table has RLS on, with no anon read and no direct insert.
- **Real owners:** `catalogue_health` run as the owners of the three largest catalogues, and refused for an outsider,
  who also gets no pairs.

**Follow-up (`carehub_20270128`):** the first version's health check took **13 s** on the largest catalogue (3,228
items), 8.8 s of it in `catalogue_pairs`. There were two causes:

- most names have no number, so "same numbers" put nearly every item in one group (the trigram index join was slower
  still, at 17 s);
- as SECURITY INVOKER, every candidate went through the RLS policies.

Near-identical names are now compared only when they share a word of four or more letters. Comparing only the first
word was faster (57 ms) but lost half the real pairs. Both read functions are now SECURITY DEFINER: they check
membership once and read only that business. The unused trigram index was dropped. Results:

| Catalogue | Items | Health check | Possible-duplicate pairs |
|---|---|---|---|
| Largest | 3,228 | 1.2 s (was 13 s) | 34 (unchanged) |
| Next | 1,705 | 0.45 s | 15 |
| Third | 1,643 | 0.35 s | 10 |

The largest catalogue scores **46/100**: 3,210 of its items are in "Other medicines" and 405 are hidden on CareFind for
having no price.

| Object | What it does |
|---|---|
| `catalogue_issue(item, issue)` | The one definition of each flag: `no_price` (default price 0 or none), `no_generic` (medicines only: not devices, personal care, food, general retail or services), `no_barcode` (anything but a service), `other_category` (none or "Other medicines"), `unlinked` (not linked to the library), `hidden` (listed on CareFind at a location with no price, and not prescription-only). |
| `catalogue_pairs(business)` | Possible duplicates among current items: the same barcode; the same letters and digits; or trigram similarity ≥ 0.8 between names that share a word of 4+ letters (`carehub_20270128`), with the same numbers ("500mg" never pairs with "250mg") and no size or pack word between them (`catalogue_size_variants`). Dismissed pairs are left out. |
| `catalogue_duplicate_pairs(business, offset, limit)` | A page of pairs, barcode matches first, each side with its details, number of locations and stock. |
| `catalogue_duplicate_dismissals`, `dismiss_duplicate_pair` | "Not duplicates": that pair is not suggested again. Owner or manager. Members read; nobody writes the table directly. |
| `catalogue_health(business)` | `{ total, score, counts, duplicate_items }`. The score is 100 minus each flag's weight times the share of items with it: no price 25, "Other medicines" 20, duplicates 15 (items in a pair), no generic 10, no barcode 10, not linked 10, hidden on CareFind 10. An empty catalogue has no score. |
| `master_catalog_page` | Gains `p_health` (one flag at a time). Old calls work unchanged. |
| `set_master_category(business, ids, code)` | Up to 500 items. With no code, a linked item takes its library category. Only `category_code` changes: the category text locations sell under (which the stock ledger reads for Services) and prescription status are untouched. Owner or manager. |
| `merge_master_items(business, keep, drop)` | Owner only, one transaction, described below. |
| `is_carefind_unpriced(rx, price)`, `carefind_products`, policy "public can view listed products" | CareFind leaves out non-prescription items with no price (≤ 0). The business's members, the listing's owner and an approved claimant still read them. |

**Merging** (`merge_master_items`), per location:

- **Only the dropped item is carried there.** Its products are linked to the kept item and take its name; the carrying
  moves over and keeps its state and price override.
- **Both are carried.** Each dropped product's stock above zero moves into the kept product through
  `apply_stock_change` ('correction', source `catalogue_merge`, one movement on each side). Its batches move with it.
  It is stopped (`branch_products.active = false`) and taken off CareFind. It is **not deleted**: its sales, orders,
  movements and reviews stay on it.
- **Stock below zero** is not moved, since that would take the kept product below zero. It stays on the stopped product
  and the result counts it (`negative_left`), so the owner can count it.

What the kept item takes from the dropped one:

- it fills its empty details from it (generic name, strength, form, pack, barcode, description, price, cost);
- it takes the dropped item's category when its own is empty or "Other medicines";
- it takes the stricter prescription status;
- it takes the dropped item's library link when it has none.

Its products then receive that status, generic name and barcode through `catalog_mirror_products` (never looser).
Prices are not changed; Push sets them.

The dropped item is archived, its pending library suggestion is withdrawn, and its dismissals are removed.

**Refused merges**, as Inventory's "Clean up duplicates" refuses them:

- batch-tracked products;
- a service against a stocked product at the same location.

**Known limit:** like any archived item, a product later added at a location under the dropped item's exact name
creates a new catalogue item with that name.

### App (`apps/carehub/src/modules/master-catalog`)

- **Health panel** (`CatalogueHealthPanel.jsx`): the score (good from 80, fair from 50) and every flag above zero.
  - A flag filters the list; pressing it again clears the filter.
  - "Possible duplicates" opens the duplicates review.
  - The panel is hidden before the migration.
  - A failed health check never blocks the list.
- **Possible duplicates** (`DuplicatesModal.jsx`):
  - Each pair shows why it was found, and both items with their details, locations and stock.
  - The item at more locations is kept by default (then the one with more stock, then the linked one).
  - **Merge…** asks for confirmation and reports what moved; **Not duplicates** dismisses the pair.
  - The database's refusal is shown as written.
- **Set category** in the bulk bar (`CategoryDialog.jsx`): a standard category, or "Use each item's CareHub library
  category".
- The score refreshes after save, carry, push, archive, restore, library links, category changes and merges.
- Repository: `getHealth`, `duplicatePairs`, `dismissPair`, `merge`, `setCategory`, `getPage({ health })`.
- Rules: `HEALTH_ISSUES`, `scoreTone`, `duplicateReason`, `mergeSummary`.

### Security implications

- No permission is widened. Reads are SECURITY INVOKER under the existing RLS and also check membership.
- Writes are SECURITY DEFINER and check the caller first:
  - **owner or manager** of the main business for categories and dismissals;
  - **the owner only** for merges, which move stock at every location.
- Every statement is scoped to the business, and the dismissals table refuses direct writes.
- A merge goes through the stock ledger, so it is journalled with the caller's identity. Nothing is deleted.
- CareFind only loses rows: unpriced items stop being public. Owners, claimants and members still see them. The view
  still exposes only CareFind's columns, never cost.

### Test plan

- **PGlite:** `apps/carefind/src/test/catalogue/catalogueHealth.db.test.js` (19 tests).
  - Setup: pg_trgm; phases 1 and 4; the live stock ledger; phase 2; the live owner and manager functions.
  - Flags and the score; an empty catalogue; outsiders and the public refused; the page's flag filter and the old
    call.
  - Pairs: barcode, name and similar; never different strengths, size variants or another business's items; the page
    with details.
  - Dismiss: managers can; cashiers and outsiders cannot; no direct writes.
  - Bulk category: by code and from the library; refusals; the 500 limit.
  - Merge:
    - only the owner;
    - stock through the ledger and batches move;
    - the dropped product is stopped and kept;
    - relinking at a location carrying only the dropped item;
    - details filled and the stricter status;
    - the library link carried over;
    - stock below zero left and counted;
    - refusals for tracked products and services.
  - CareFind: unpriced items hidden from the view and the policy; prescription-only items stay; the business still
    sees them.
  - Re-running the migration.
- **Unit and UI (CareHub):**
  - `repositories/index.test.js`: call shapes, the fallback before the migration, and `p_health` sent only when set;
  - `catalogueRules.test.js`: flags, score tone, reasons and merge summary;
  - `MasterCatalog.health.test.jsx`:
    - the panel and its hidden state;
    - filtering and clearing;
    - a failed health check;
    - merge with confirmation, refusal and dismiss;
    - pair load error;
    - bulk category with validation;
    - `defaultKeep`.
- **Manual, after applying the migration:**
  1. Master Catalog (as the owner): the health panel shows a score. Press "No price" and check that the list filters.
  2. Open "Possible duplicates". Merge a pair at a location that stocks both, then check:
     - the kept product's stock and the two 'correction' movements;
     - that the dropped product is stopped;
     - that its sales history is still there.
  3. Select items and choose "Set category"; check that the "Other medicines" count drops.
  4. On CareFind, check that a listed product with price 0 is gone and that a prescription-only item still shows
     "ask the pharmacist".
