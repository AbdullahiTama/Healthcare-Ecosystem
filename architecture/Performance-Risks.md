# Performance Risks — Care Ecosystem

## Unbounded queries dominate both products

**CareHub:** only 3 of ~20 list endpoints in `lib/supabase.js` have any `limit` at all (`staff_notifications` at 50, `stock_movements` and `field_activities` at 100). Every other list query (`products`, `sales`, `clients`, `expenses`, `debts`, `purchases`, `patients`, `prescriptions`, `staff`, `businesses`, `enterprise_locations`, `territories`, `internal_messages`, `stock_batches`, `orders`) fetches the entire table for a business with no pagination, degrading linearly with history as each tenant's data grows.

**CareFind:** `Search.jsx` caps results at `limit(40)` and `AdminPanel.jsx` caps several of its ~12 parallel queries at `limit(30)`–`limit(100)`, but neither implements pagination beyond that single capped page — a user or admin cannot see anything past the cap, and the cap itself doesn't scale with platform growth.

## Client-side aggregation over full unbounded fetches

Every total shown anywhere in CareHub (revenue, stock value, expense sums, every `StatCard` number) is computed in JavaScript after downloading the complete relevant row set — there is no server-side `count`/`sum` anywhere in `lib/supabase.js`. The amount of data transferred to compute one number grows with total historical record count, not with the size of the answer.

## Serial write loops (true N+1 patterns)

- CareHub's CSV bulk-import (`Inventory.jsx`) and offline-sale sync (`syncOfflineSales`) both issue one sequential `await` per row/item instead of a single bulk-insert request — importing 500 products means 500 sequential round trips.
- `Doctor.jsx`'s imaging-request loop has the same shape at lower cardinality.
- Where the app *does* batch correctly (every "children for a list of parents" function — `getOrderItems`, `getMessageRecipients`, `getActivityComments`, etc. — via a single `in.(id1,id2,...)` query) is worth preserving as the pattern to extend elsewhere, not just a footnote.

## Serial read waterfalls

`lib/supabase.js`'s `getAllLocations()` chains up to three sequential, dependent Supabase calls (`getBusinessById` → conditionally `getBusinessById` again → `getBranches`) where at least the redundant second call could be avoided.

## Redundant re-fetching

CareHub's `Inventory.jsx` calls both its own local `getProducts()` **and** the parent `BusinessDashboard`'s `loadProducts()` after every single mutation — two network round trips doing the same job. This pattern (a page re-fetching data a parent already owns and re-fetches too) is worth checking for elsewhere given how central `pageProps`-based state sharing is to CareHub's architecture.

## Third-party API calls on the critical path

- CareHub's `reverseGeocode()` calls OpenStreetMap's Nominatim service synchronously as part of the field-activity logging flow, with no caching of previously-resolved coordinates and no rate-limiting — repeated use risks hitting Nominatim's usage policy.
- CareFind's `lib/reviewAI.js` calls the Anthropic API directly from the browser (if functional at all — see `Service-Catalog.md`) as part of rendering a business/drug profile, coupling that screen's perceived performance to a third-party LLM's latency with no caching of prior analysis results.

## No index visibility anywhere

Neither product has a schema file, so index adequacy for either database is entirely unauditable from source. Given the query shape both products share (near-universal `business_id`/`user_id` equality filter plus `order by created_at`), the minimum needed is a composite `(tenant_id, created_at)` index on essentially every table in `Database.md` — this can't be confirmed to exist and should be checked directly against the live project.

## Large single-file components (CareFind-specific)

`Feed.jsx` (1,823 lines), `AdminPanel.jsx` (1,868 lines), and `Profile.jsx` (853 lines) each own a large amount of simultaneous client state and, in `AdminPanel.jsx`'s case, fan out to ~12 parallel queries on every mount. Beyond the maintainability concern (`Technical-Debt.md`), a component this size re-renders a proportionally large tree on any state change within it — worth profiling directly if either screen is reported as sluggish, since nothing in source rules out unnecessary re-render cascades at this scale.

## What would help most, in order

1. Add pagination (not just a cap) to every unbounded list query in both products — the single highest-leverage fix, since it's the root cause behind both the "unbounded queries" and "client-side aggregation" findings above.
2. Replace the serial write loops with real bulk inserts (`lib/supabase.js` already demonstrates the pattern correctly elsewhere in the same file).
3. Verify index coverage against the live schema, prioritizing the tables with the highest expected row-count growth (CareHub: `sales`, `patients`, `prescriptions`; CareFind: `posts`, `live_*`, `transactions`).
4. Cache `reverseGeocode` and `reviewAI` results rather than re-computing them on every view.
