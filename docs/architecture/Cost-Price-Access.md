# Cost price: a data-level permission

2026-11-22. CODE_AUDIT A25 (step 2) and A47. Follows [POS-Cost-Visibility.md](POS-Cost-Visibility.md) (step 1:
screens). Owner decisions: fix both exposures with one mechanism; on Purchases, staff without the permission type the cost
themselves.

## Root cause

Row security on `products` decides **which rows** a user sees, never **which columns**:

| Who could read `products.cost_price` | Through | Scale (live, 2026-11-22) |
|---|---|---|
| **Any signed-in user, of any business or none** (A47) | policy `public can view listed products` (role `public`) | 11,122 costs, 14 businesses |
| Every staff member of the business, including a cashier without "See cost prices" (A25) | policy `products of own business` | all of the business's products |

Logged-out visitors could not read the table: another policy calls a function anon cannot execute, so the request fails.

Postgres column privileges apply per database role, and every CareHub and CareFind user is the same role
(`authenticated`), so the column cannot be granted to some users and not others. It is closed to the API roles
altogether, and costs are read through a function that checks the person.

## Design

```
CareHub (any page)                         database
───────────────────                        ────────────────────────────────────────────────────────────
productRepository.getAll ─ products?select=<PRODUCT_COLUMNS> ──► rows, never cost_price (column not granted)
                         └ rpc/product_costs(business) ───────► { id: cost } if can_view_cost_price, else {}
                           withCosts(rows, costs) → the shared catalogue (POS, Inventory, Purchases, Orders, Stock…)
```

| Piece | Where |
|---|---|
| `can_view_cost_price(business)` and `product_costs(business, ids)` (SECURITY DEFINER, authenticated only) | `supabase/migrations/carehub_20270202_cost_price_access.sql` (part 1, additive) |
| SELECT on every column of `products` except `cost_price` for `anon` / `authenticated` | `supabase/migrations/carehub_20270203_cost_price_column_guard.sql` (part 2) |
| Column list, cost merge, offline-copy stripping | `apps/carehub/src/modules/inventory/productColumns.js` |
| Readers | inventory repository (getAll, getById, create, createMany, update, updateMany), e-commerce fallback read, representatives product search |

### Who sees costs (same rule as the app, `lib/permissions.js`)

For a member of the business (`current_business_ids`):

| Person | Costs |
|---|---|
| Owner of the business or of a parent business; active staff with role `Owner` | yes |
| Active staff whose role is a custom role (`roles` row) with **See cost prices** on | yes |
| Active staff on the preset **Manager** with no custom row of that name | yes |
| A business that redefines "Manager" as a custom role without the switch | no (the custom row wins, as in the app) |
| Cashier, Pharmacist and other presets; custom roles without the switch; inactive staff | no |
| Another business, a CareFind shopper, logged-out visitors | no |

### Behaviour in the app

* **Permitted users:** nothing changes. Costs arrive with the catalogue (one extra request, made at the same time as the
  first page).
* **Everyone else:** rows have no `cost_price` key, so nothing on screen, in exports or in browser storage can show it.
* **Saving:** someone who cannot see costs never sends one (`Inventory.saveProduct`, duplicate "Update Existing"), so an
  edit cannot save a blank over the real cost. Recording a purchase or importing a spreadsheet still saves the cost
  typed or uploaded (writing the column is unchanged).
* **Purchases:** the cost pre-filled when a product is added to a purchase comes from the product's cost, so it starts
  empty for staff without the permission. They type the invoice cost, and saving still updates the product's cost. The
  Purchases list's "Cost" column is the purchase's own unit cost (`purchases.cost_price`). It follows the Purchases
  permission and is unchanged.
* **Rep ledger:** the default unit value (the company's cost) is filled only for people allowed to see costs.
* **Offline copy:** the catalogue saved in browser storage is per business, not per person, so it never holds costs
  (copies saved before this change are cleaned as they are read). While only the saved copy is on screen (offline, or
  for the first seconds), permitted users see "No cost set" until the server load arrives.
* **If `product_costs` fails:** products still load, without costs, and the failure is logged.

## Security implications

* Narrows access only. No policy changes. Writes to the column are unchanged.
* `product_costs` is scoped to the one business asked for and to a member of it; it takes the caller's identity from
  `auth.uid()` / `auth.email()`, never from a parameter.
* SECURITY DEFINER functions, the `carefind_products` view (owned by postgres; never had cost) and the service role are
  unaffected.
* **Maintenance rule:** after part 2, a new column on `products` is not readable by the API roles until granted
  (`GRANT SELECT (<column>) ON public.products TO anon, authenticated;`) and added to `PRODUCT_COLUMNS`. Both the table
  comment and the migration header say so.
* Not covered (follow-ups): `stock_batches.cost_price` (no batch has a cost today; readable by staff of the business),
  and purchase records' own costs (by design, see above).

## Rollout

1. Apply part 1 (additive; nothing changes for anyone).
2. Deploy the CareHub app (it names its columns and reads costs through `product_costs`; works before and after part 2).
3. Apply part 2. From then on `select=*` on products by the API roles fails with `42501`. Nothing in CareHub or CareFind
   does it (guarded by `productColumns.test.js`).

Rollback of part 2: `GRANT SELECT ON public.products TO anon, authenticated;` (the app keeps working).

## Tests

| What | Where |
|---|---|
| Before/after on PGlite: a shopper and a cashier read cost before; after, nobody reads the column (not even the Owner directly); `select *` refused; every other column still readable; who gets costs from `product_costs` (Owner, staff Owner, custom role, preset Manager, redefined Manager, cashier, inactive, other business, parent owner and parent staff on a branch, ids subset, anon refused); purchases and edits still save cost; a CareFind claimant still updates; idempotent | `apps/carefind/src/test/cost-price/costPriceAccess.db.test.js` |
| Repository never asks for `*` or `cost_price`; merges costs; no key without permission; loads when the cost read fails; saves keep the sent cost | `apps/carehub/src/modules/inventory/repositories/index.test.js` |
| Source guard (no `products?…select=*`, no whole-row write) and helpers | `apps/carehub/src/modules/inventory/productColumns.test.js` |
| An edit by staff who cannot see cost sends no cost; the Owner's edit does | `apps/carehub/src/modules/inventory/Inventory.stock.test.jsx` |
| The offline copy never holds costs; old copies cleaned | `apps/carehub/src/modules/inventory/hooks/useProductCatalog.test.jsx` |
| Rep ledger product search | `apps/carehub/src/modules/representatives/__tests__/repository.test.js` |

**Manual check after part 2:** as the Owner, the POS and Inventory show costs. As a Cashier, no costs. In the browser's
developer tools, a `products?select=cost_price` request returns 401/403 (permission denied).
