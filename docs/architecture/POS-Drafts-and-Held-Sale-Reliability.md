# POS: unsaved sales, duplicate held sales, and re-holding an edited sale

Status: built 2026-11-02 on `claude/keen-mayer-4kpxda`; app changes ship with the branch. The database part,
`supabase/migrations/carehub_20270101_held_sale_edit_grants.sql`, was **applied to production on 2026-11-02** with the
owner's approval (version `20261102135828`) and probed live (results in its header). Re-holding an edited sale works in
production from that moment, with the app already deployed; the zero-row check and the other app fixes arrive when the
branch is merged to `main`.

Related: [Sales-Corrections.md](Sales-Corrections.md) (how held sales work), [Client-Totals-Debts-and-Held-Sales.md](Client-Totals-Debts-and-Held-Sales.md).

## 1. What staff reported and what was actually wrong

| Report | Cause (verified) |
|---|---|
| Entries disappear after leaving the POS, switching page, or checking Wi-Fi/Bluetooth | The cart, customer, discount and payment inputs lived only in React state. Anything that unmounts the POS lost them: going to another screen (App.jsx keys its routes by `location.key`, so every navigation remounts the page), the app moving itself onto a new build at the next change of screen (`BuildUpdateWatcher`, after any deploy), and phone browsers discarding a backgrounded tab while system settings are open. |
| The same held sale appears more than once | `holdSale` had no in-flight guard (charging did). A double tap on **Hold sale**, or **Hold sale** then **Hold & print invoice**, inserted the held sale two or three times. Live data: identical held sales 0.0–1.5 s apart, e.g. three copies of a ₦300 hold within 0.8 s, and a new pair at 13:42:27 on 2026-11-02 while this was being written. A second, rarer path: a sale whose POST committed but whose answer was lost was parked in the offline queue and replayed as a second row. |
| Editing a held sale and holding it again is sometimes refused | **Every** re-hold of an edited sale is refused in production. The till saves it with a `PATCH` of `items, subtotal, discount, total, balance, client_id, client_name, notes`, but `carehub_20261211_sales_write_hardening` (applied 2026-10-27) left signed-in users UPDATE on only `status, is_on_hold, notes`. Edge logs: 6 of 6 `PATCH /sales` in the last 24 hours answered 403; a rolled-back probe gets `permission denied for table sales`. Sales-Corrections.md had asked for this reconciliation before the migration was applied. Separately, a held sale completed on another till since it was opened matched no row, and the till said "Held sale updated." while the edits went nowhere. |

## 2. What changed

### Unsaved sales are kept on the device (`modules/pos/posDraft.js`, `POS.jsx`)

- The whole sale in progress is one draft: cart, customer, discount, payment method and amounts, credit deposit, hold
  note, and **which held sale is open for editing**. POS keeps it with the existing `hooks/usePersistentDraft`
  (versioned, 7-day expiry, every storage access guarded).
- Scope: one draft per **location** (each has its own products) and per **staff member** (`pos_<business>_<staff|owner>`),
  so on a shared till one person's sale is never shown to or charged by someone else.
- On return the cart is exactly as it was, with a dismissible notice: "Picked up where you left off".
- The draft is cleared the moment a sale is **recorded** (charged, including queued offline) or **held**. A reload on
  the receipt screen therefore can never bring back a cart that was already charged. (The receipt screen itself is not
  kept; Recent → Reprint covers it.)
- Restored values are validated field by field (`normalizePosDraft`): a malformed line or field is dropped, never the
  whole cart.
- Opening a held sale while a different sale is in the cart now asks first (**Replace the current sale?**) instead of
  silently replacing it. Reopening the held sale already in the cart keeps its unsaved edits.
- Switching location no longer loses the cart (each location has its own draft); the switch prompt now says so.

### Held sales are written once

- **Hold** is guarded by a ref (synchronous) and state (the buttons): a second tap, on either button, is ignored until
  the first save finishes. Buttons show "Saving…" and `aria-busy`.
- **Idempotent inserts:** `saleRepository.create` gives every sale its row id (`lib/uuid.js`) before the first attempt
  and keeps it in the offline queue. A replay whose first attempt had landed is refused by the primary key, and
  `syncQueued` then removes it from the queue as already recorded. Only Postgres' duplicate-key refusal counts: a 409
  from a foreign-key violation (a sale naming a removed customer) is **not** recorded and stays queued and reported.
  Entries queued by older versions (no id) behave as before.
- An edited held sale restored after a reload is still linked to its held row, so **Save changes** updates that row
  rather than holding a second copy.

### Re-holding an edited sale

- **Database** (`carehub_20270101_held_sale_edit_grants`, applied 2026-11-02): signed-in users get UPDATE on
  `items, subtotal, discount, total, balance, client_id, client_name, notes`; UPDATE on `status` and `is_on_hold` is
  removed (no client uses it). Rollback is in the file header.
- **App:** `updateHeld` asks for the updated row back. No row means the held sale was completed since it was opened:
  it throws `HeldSaleClosedError`, the till says so, keeps the cart and treats it as a new sale (so Hold creates a new
  held sale and Charge records it normally, instead of being refused with "This held sale was already completed").
  The same happens when a restored draft points at a held sale that is no longer in the Held list (checked only once
  that list has loaded).
- Any other failure keeps every change on the till and says so, with a specific message when offline.
- The hold dialog reads **Save held sale / Save changes** when editing, so it is clear nothing new is created.

## 3. Security implications

- **Database grant (widened, bounded):** the eight held-content columns become updatable by signed-in members of the
  business. What that permits is limited by protections that are already live and unchanged:
  - the row policy (own business only);
  - `sales_guard_direct_update`: on a held row, hold status, number, business, creation time and resume link cannot
    change; on a completed sale, money and customer columns cannot change at all from the client (Owner corrections go
    through the audited `edit_sale` / `delete_sale`);
  - a held row is not money: it is excluded from takings, client totals and stock, and completing it inserts a new
    sale that the INSERT guards validate in full (price override permission, batch expiry, credit customer).
  Still ungranted: `amount_paid`, `payment_method`, `payment_split`, `is_credit`, `refunded_amount`, `deleted_at`, and
  every identity column. `status` / `is_on_hold` UPDATE is removed (narrowed). anon keeps nothing.
- **Client-chosen sale ids:** INSERT on `id` was already granted. A guessed id that exists (any business) only yields a
  duplicate-key refusal; nothing is overwritten (plain INSERT, no upsert). Ids are random v4 UUIDs.
- **Data on the device:** the draft holds product lines, the typed customer name and the picked customer's id and name
  (not phone or other details), per business and staff member, for at most 7 days. This is the same exposure as the
  Purchases draft and less than the offline sale queue, which already stores whole sales.

## 4. Owner follow-ups (not done automatically)

1. ~~Approve and apply the grant migration~~ — done 2026-11-02; live probe passed (see its header).
2. **Duplicate held sales still open** (business `f7d9a912…`, 2026-11-02): `HLD994467` (₦13,600; its copy `HLD290011`
   was charged) and the pair `HLD883219` / `HLD662036` (₦100 each). Held sales cannot be deleted by design; complete or
   leave them, or ask platform staff for a one-off fix.
3. **Duplicates that were each charged** (same items, held within seconds, each later completed, e.g. `HLD688936` /
   `HLD112104` ₦150 each, `HLD995335` / `HLD964011` ₦1,700 each, `HLD426162` / `HLD820430` ₦500 each). Some may be real
   repeat sales; any that are not are double revenue and can be corrected by the Owner in Financial Reports.

## 5. Test plan

- **PGlite:** `apps/carefind/src/test/held-sales/heldSaleEditGrants.db.test.js` (9) with the live trigger and live
  grants: reproduces the refusal; after the migration an edited held sale saves; a held sale still cannot be released,
  relabelled, given a status or marked paid; a completed sale's money and customer stay Owner-only; notes still work;
  anon has nothing; re-running changes nothing.
- **Unit:** `modules/pos/posDraft.test.js` (7): emptiness, exact round trip, field-by-field repair, minimal customer and
  held-sale references, key scoping.
- **Repository:** `modules/pos/repositories/index.test.js` (+6): ids before the first attempt and kept in the queue; a
  landed replay is dropped without a second POST; a foreign-key 409 is kept and reported; legacy entries unchanged;
  `updateHeld` throws on a closed hold and never touches another business.
- **Component:** `modules/pos/POS.draft.test.jsx` (12): the cart survives leaving and returning; per location; cleared
  after charge and after hold; no silent replacement; no phone stored; a double tap holds once; a restored edit saves
  onto the same held row; a closed held sale keeps the cart and becomes a new sale; the link is kept while the list
  loads; a failed save keeps everything.
- Each new behaviour was mutation-checked: removing the hold guard, the stale-link check, the draft clearing, the
  duplicate recognition or the zero-row check fails its test.
- **Live probe (done 2026-11-02, rolled back):** owner and non-Owner staff can save an edited held sale; nobody can
  release a held sale, set its status or mark it paid; a completed sale's money and customer stay Owner-only; charging
  the edited held sale converts it.
- **Manual (after the branch is deployed):** on a phone, add products, open system Wi-Fi settings, return: the cart is
  there. Hold a sale tapping Hold twice: one held sale. Open it, add a product, Save changes: one held sale with the new
  total. Open it on two devices, charge it on one, Save changes on the other: told it was completed, cart kept.
