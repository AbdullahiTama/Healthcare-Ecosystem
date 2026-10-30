# Data loading in CareHub

Status: implemented and tested (October 2026). No database or permission change.

How CareHub pages read lists from Supabase, the rules every page follows, and the audit that brought the heavy pages in line. The product catalog has its own page: [Inventory-Large-Catalogs.md](./Inventory-Large-Catalogs.md).

## The hard limit behind most of this

PostgREST returns **at most 1000 rows per request** on this project (`db-max-rows`). A request for more does not fail; it silently stops at 1000. Every list that can grow past that must be paged with `pagedQuery` (`lib/pagedQuery.js`), with an `id` tiebreaker in its `order` so pages cannot shift.

## Rules

1. **Ask for what the screen shows.** A screen that shows open sales asks for open sales; a report for October asks for October. Never download a table's whole history to filter it in the browser.
2. **Page anything that can grow.** Use `pagedQuery`. A single request is only for reads that are naturally small or explicitly limited (`limit=50`).
3. **Load shared data once.** The product catalog comes from `useProductCatalog` (passed to pages as `products`, `setProducts`, `catalog`); clients come from `useClients`; sales from the hooks in `hooks/queries.js`. A page does not fetch its own copy, and after a save it updates the shared copy from the rows the server returned.
4. **Use React Query for server state** (`hooks/queries.js`, `keys`). It gives de-duplication, caching, retry, refetch on reconnect and protection against out-of-order answers.
5. **Independent requests run in parallel** (`Promise.all`), not one after another.
6. **Every list has loading, error and empty states, and they are different.** A failed load is never shown as "nothing here" or as zero. Errors are logged with a `[module]` prefix and shown with a Retry.
7. **Counts come from the database** (`Prefer: count=exact`, head request) or from slim column selections, not from downloading rows to call `.length`.

## What changed, page by page

| Page | Before | Now |
|---|---|---|
| Dashboard | Downloaded **all sales** (unpaged, so silently capped at 1000) to find held and credit sales; stock tiles said "0 alerts" while the catalog loaded; owner stock alerts could fire from a saved, out-of-date copy | `useOpenSales` (held + credit with a balance, paged). Stock tiles and worklist show loading until the catalog is loaded. Stock alerts only from a fresh server list. The 30-day velocity digest fetches 30 days of sales only when it is due (once a day) |
| POS | All sales for the held, credit and Recent tabs | `useOpenSales` and `useRecentSales(50)`; Recent tab has an error state with Retry |
| Reports | All sales, all expenses and all purchases (sales and purchases unpaged, so capped at 1000: totals were wrong past that) | Only the selected period (`periodRange`) for sales and purchases, paged; outstanding credit from the open-sales read; React Query caches each period |
| Branch overview | All sales and all appointments for every branch | Per branch: today's sales, held sales, and a database count of sales; a branch that fails is reported ("totals may be incomplete"), not shown as zero |
| Orders | Five requests one after another, one of them a fresh copy of the full catalog; a failed load showed an empty list | Shared catalog; requests in parallel; error state with Retry |
| Stock | Batches (unpaged), warehouses and a fresh copy of the catalog, sequentially | Shared catalog; batches paged; parallel; error state with Retry |
| Purchases | Its own copy of the catalog; stock changes were not reflected in Inventory or POS until a reload | Matches items against the shared catalog and writes the changed rows back into it. Saving waits for the catalog (matching a half-loaded list would create duplicates) |
| Online store | A fresh copy of the catalog on every activate/pause; listings unpaged; any error mentioning "products" was shown as an empty store | Shared catalog combined in memory (`mergeInventoryStatus`); listings paged (`getListings`); only a missing table reads as empty, other failures show an error |
| Locations | Every branch's **entire** catalog, one branch after another, to count products and low stock; failures shown as zeros | `getStockSummary` (three columns, paged), all branches in parallel; a failed branch says "Figures unavailable" with Try again |
| Consultations, Debts, Appointments, Demand, consultation forms | Each downloaded all clients itself and hid failures | Shared `useClients` (one cached download); a failed list shows a note under the picker with Try again; a client added in a form appears in every picker |
| Debts | Unpaged; a failed load showed "no debts" | Paged; error state with Retry |
| Appointments | Unpaged and oldest first, so past 1000 the **newest** appointments were dropped | Paged |
| Consultations list | Unpaged | Paged |

Small lists left as single requests on purpose: notifications (`limit=50`), staff, territories, warehouses, stock-check sessions, and the order detail lists (filtered by order ids).

## Coming back to an idle counter (2026-10-30)

Staff leave CareHub open for hours. When they come back the dashboard **resumes, it does not reload**. What was on screen stays usable at once and brings itself up to date in the background; nothing in progress (a cart, payment fields, a held sale, a half-filled form) is touched.

React Query already refetches stale queries on window focus and on reconnect (rule 4). `providers/RefreshProvider.jsx`, mounted by `BusinessDashboard`, adds what it does not cover, using `lib/resume.js`:

* **When.** The tab returns after 5+ minutes hidden; the device slept with the tab visible (a lid or lock screen fires no focus event, so a late timer tick gives it away); or the connection comes back. Signals that arrive together run one refresh.
* **Session first.** `renewSession()` (`lib/sessionFetch.js`) forces a token refresh before anything refetches. On a till whose clock is behind, supabase-js never refreshes by itself; see [Session-Expiry-and-Anon-Fallback.md](./Session-Expiry-and-Anon-Fallback.md).
* **Then everything on screen.** `refetchActiveQueries` asks React Query to refetch every active query (`cancelRefetch: false` joins a refetch React Query already started instead of doubling it). Queries keep their data while refetching, so nothing blanks. Work that is not a query joins through `useRefreshOnResume`; today that is the offline sale queue (`saleRepository.syncQueued`), registered by the shell.
* **What staff see.** `components/layout/RefreshIndicator.jsx`, a small pill: "Updating…", then "Updated just now" for 3 s; or "Couldn't update. Showing what was loaded earlier." with Retry. Offline shows no pill, because the offline strip already says so. On the dashboard a failed refresh also shows the page's own error surface, so there are briefly two Retry buttons; both do the same thing.

**Offline queue safety.** Because the queue now replays on resume and reconnect as well as on mount and the Sync button, `syncQueued` is single flight: overlapping calls join the run in progress. `sales` has no unique key on `txn_no`, so two runs would record each queued sale twice. It also removes the sales it sent from the queue *as it stands afterwards*, so a sale parked during a sync is kept (it used to rewrite the queue from its pre-sync snapshot). One gap remains: two CareHub tabs on one till share the queue and can each replay it. The durable fix is a unique `(business_id, txn_no)` with insert-or-ignore on replay.

## Tests

* `modules/pos/repositories/index.test.js`: `getOpen` (held + credit, de-duplicated, newest first, tenant-scoped, pages past 1000), `getSince` ([from, to)), `getRecent`, `count` (head request, no rows).
* `modules/reports/periodFilter.test.js`: `periodRange` for every period, December rollover, and agreement with `inPeriod`.
* `modules/purchases/repositories`, `modules/debts/repositories`, `modules/appointments/repositories`: paging past 1000 (appointments: the newest are kept).
* `modules/ecommerce.test.js`: the catalog is not downloaded when products are passed; listings page past 1000; a missing table reads as empty but an outage is raised.
* `modules/inventory/repositories/index.test.js`: `getStockSummary` selects three columns and counts correctly.
* `modules/clients/components/ClientsLoadNote.test.jsx`: the picker note and its retry.
* Existing page tests updated: DashboardHome, POS, Orders, Ecommerce.
* `lib/__tests__/resume.test.js`: when a resume fires (and when it does not), session before refetch, failure and offline states, one run for signals that arrive together, retry once after a failed run.
* `providers/__tests__/refetchActiveQueries.test.js` (real QueryClient): on-screen queries refetch and keep their data meanwhile; off-screen ones are left alone; an in-flight refetch is joined; a failure rejects.
* `modules/pos/repositories/index.test.js`: `syncQueued` joins a run in progress; a sale queued during a sync is kept.

## Manual test plan

Use a business with many products and sales, DevTools Network open.

1. Dashboard: no `sales?…select=*` request without `is_on_hold`, `is_credit` or a date filter. Held and owed figures match the POS tabs.
2. POS Recent tab: one request with `limit=50`. Block it: an error with Retry.
3. Reports: switch Month to another month: one sales request with `created_at=gte…&created_at=lt…`. Switch back: no new request within a minute (cached).
4. Orders, Stock, Online store: no `products?…` request on open (the dashboard already has the catalog). Block the page's own requests: error with Retry, not an empty list.
5. Purchases: record a purchase of an existing product, then open Inventory: the new stock is there without a reload.
6. Locations with several branches: requests run in parallel and `products?…select=id,stock,reorder_level,category`; block one branch: that card says "Figures unavailable".
7. Debts, Appointments, Demand: block `clients?…`: the picker note appears; Try again restores it; typing a name still works.
8. Resume: open POS, add an item, switch to another tab for 5+ minutes (or close the laptop lid), come back. You should see "Updating…" then "Updated just now"; one `token?grant_type=refresh_token` request, then the screen's queries; the cart is unchanged. Block `rest/v1/*` before coming back: "Couldn't update" with Retry, and the earlier figures stay.
