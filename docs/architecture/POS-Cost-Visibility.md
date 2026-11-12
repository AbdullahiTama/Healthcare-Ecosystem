# POS: quick cost price visibility

2026-11-11. Pending item 3 of "Still Pending Issues – CareFind Hub". App only; no migration. CODE_AUDIT item A25 records
the data-level follow-up.

## What the user gets

Authorised users see costs **straight away**; nothing has to be turned on. A **Cost** button (eye icon) beside the search
box hides them when a customer can see the screen; hiding is remembered on that device for that business and person
(a new device or cleared storage shows costs again).

- **Product cards:** a band under the price, `Cost ₦800` with the margin on the selling price (`33%`, red when the product
  sells below cost). A product with no cost recorded shows an amber *No cost set* (never a 100% margin). Services show
  nothing.
- **Cart lines:** `Cost ₦800 each · profit ₦800` (or *loss*), using the line's actual price, overrides included.
- **Under the total:** `Est. profit ₦400 · 20%`, after the discount. Lines without a cost are left out and counted:
  `Est. profit (1 without cost)`.

**Change 2026-11-12.** The first version started hidden behind an unlabelled eye icon, and every staff member at the
first business to try it is on a custom role without the permission, so in use "it is not showing". Costs are now shown
by default to authorised users, the band on the card is easier to read, and the button is labelled *Cost*. Staff on
custom roles still need the Owner to turn on *See cost prices at the POS* for their role (Staff › Roles & Permissions).

Nothing about the sale changes: no extra step, dialog or confirmation; prices, totals, receipts, held sales and what is
saved are untouched. The switch is one tap and works mid-sale.

## Who may see it

A new role switch, **See cost prices at the POS** (`canViewCostPrice`), in Staff › Roles & Permissions:

| Role | Default |
|---|---|
| Owner | always (cannot be narrowed, as for every switch) |
| Manager (preset) | on (already sees financial reports) |
| Pharmacist, Therapist, Cashier and other presets | off |
| Custom roles | off unless the Owner turns it on |

A device that remembers the switch as on shows nothing to someone without the permission.

## Design

- `pos/costView.js` (pure): `unitCost` (0 or blank = not set), `marginPct`, `saleCostSummary` (kobo arithmetic; the
  discount is shared across lines in proportion, so lines without a cost do not distort the estimate), and the
  remembered switch (`localStorage`, wrapped in try/catch; private windows simply start hidden).
- `POS.jsx`: the switch, `ProductCard`'s `showCost` prop (the cards stay memoised), the cart line and summary rows.
  The cost is the catalogue's current `cost_price` (the shared product catalogue already loaded for the POS); no extra
  request is made.
- `lib/permissions.js` and `staff/Staff.jsx`: the flag on every preset, in `buildCustomPerms`, and in the role editor.

## Security implications

- **This is a display permission, not a data boundary.** `cost_price` is already returned to every member of the
  business by the products read the POS and Inventory use (`products?select=*`, RLS by business). A cashier could read
  it through the API before this change and still can; the switch only decides what the POS shows. Nothing is widened.
- Making cost a data-level secret would need a column-level restriction on `products.cost_price` (or a view/RPC for
  non-cost roles) and changes to every reader (Inventory, Purchases, reports, transfers). That is proposed as CODE_AUDIT
  A25 for an owner decision rather than done here, because it changes access for existing roles.
- Shown by default only to authorised users; anyone can hide it in one tap when a customer can see the screen, and that
  choice is remembered per person on the device.

## Test plan

| Test | Covers |
|---|---|
| `pos/costView.test.js` (8) | cost not set vs zero, margin and loss, sale profit to the kobo, discount, lines without cost, switch memory per business and person, broken storage |
| `pos/POS.cost.test.jsx` (5) | shown to the Owner at once on cards (service and missing cost); the Cost button hides cards, lines and the estimate and shows them again; cart line and sale estimate before and after a discount; the total and Charge unchanged; hiding remembered across visits; a cashier sees no cost anywhere; a custom role with the switch sees it at once |
| Existing POS suite | the sale flow is unchanged |

**Manual check after deploy:** as Owner, open the POS (costs show on the cards), add two products and a discount, charge;
the receipt shows no cost. Tap Cost: everything hides; reload: still hidden. As a Cashier, no switch. In Staff, turn on the switch for a custom role and confirm it appears for that user.
