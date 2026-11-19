# Stock alerts open their breakdown: Sales velocity and Expiry

Last updated: 2026-11-19. App only, no database change.

## Problem (reported 2026-11-19)

Tapping a Sale Velocity or expiry notification opened a general page instead of the information behind it.

## Root causes

| Notification | What happened | Why |
|---|---|---|
| Sales velocity ("30-day sales velocity: …") | Opened Reports (sales, expenses, VAT) | Its link was `/dashboard/reports`; no screen broke velocity down, and the rule had three groups (fast, "steady", "not moving") with no slow-moving group. |
| Expiring soon / expired | Opened the whole Inventory table with a small filter chip; when Inventory was already open, nothing changed | The filter was read from the URL only when Inventory first mounted; the notification's link was a filter on the general list, not a list of the affected products. |

## Change

- **One rule for notification and breakdown.** `lib/velocity.js` classifies by units sold in the last 30 days of
  completed sales: **fast-moving** 10+, **steady-moving** 4 to 9, **slow-moving** 1 to 3, **not moving** 0 (still in
  stock). Services are left out; a product that sold is classified even when it is now out of stock (a sold-out fast
  mover is the one to reorder); one that neither sold nor has stock is left out. `lib/expiry.js` holds the expiry rule
  (expiring within 60 days, expired). The dashboard raises the notifications with these, so a notification's count is
  its breakdown's count.
- **Stock Management ▸ Sales velocity**: the four groups as tiles (count and rule) and a list per group: product, units
  sold (30 days), in stock (or "Out of stock"). A tile opens its group alone (`?group=`).
- **Stock Management ▸ Expiry**: Expiring within 60 days / Expired / Both, each a list of product, quantity in stock,
  expiry date and "In N days" / "N days ago", with the section's product and unit totals (`?expiry=`).
- **Links**: the notifications link to `/dashboard/inventory?tab=velocity` and `?tab=expiry&expiry=expiring|expired`.
  The bell opens these by the notification's kind (`notificationTarget`), so notifications stored with the old links
  open the breakdown too; an old `?expiry=` link without a tab opens the Expiry tab. Stock Management reads its tab
  and list from the URL on every render, so opening a notification while it is already showing switches to it.
- Sales velocity notifications are filed under the bell's Inventory tab.
- Loading, error (with retry) and empty states; the tab bar scrolls on phones; groups and lists are labelled sections.

## Security

No new data access. The breakdowns sit behind Stock Management's existing `inventory` permission. Sales velocity reads
the last 30 days of the business's sales through the same repository the dashboard uses (RLS: own business), and shows
only units per product, no prices, customers or staff.

## Tests

- `apps/carehub/src/lib/velocity.test.js` (four groups, band edges, sold-out mover, services, window) and
  `apps/carehub/src/lib/expiry.test.js`.
- `apps/carehub/src/modules/stock-management/StockAlerts.breakdown.test.jsx` (8; all fail on the previous wiring): each
  notification's link opens its breakdown with the right products, quantities and dates; held sales are not counted;
  a group alone; error and retry; switching while already open; an old expiry link; stored links overridden by kind.

## Manual check

Dashboard as the Owner raises the alerts (once a day). Bell ▸ the sales velocity notification: Stock Management opens
on Sales velocity with four groups; the counts match the notification. Bell ▸ an expiry notification while Inventory
is open: the page switches to Expiry with the affected products, quantities and dates.

## Not covered

Expiry is the product's own expiry date. Products tracked by batch keep per-batch dates in `stock_batches`; none is
tracked live (2026-11-19). When batch tracking is used, the expiry breakdown should list batches.
