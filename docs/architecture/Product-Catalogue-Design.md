# Product Catalogue: Review and Design

Status: proposal for approval (2026-10-27). Nothing in this document is built yet.

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
