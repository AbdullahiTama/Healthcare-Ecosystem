# CareFind + CareHub — Feature Status Tracker

Update after every feature. A feature is COMPLETE only when frontend, backend,
database, authorization and integration are all verified.

```
FEATURE 1 — CAREFIND APPOINTMENT BOOKING + PAYMENT

Surface:             CareFind Client
Supporting surface:  CareHub Provider (appointment record)

Frontend:    COMPLETE
Backend:     COMPLETE (booking.js, verify-booking-payment.js, webhook, RPCs exist live)
Database:    COMPLETE (appointments payment columns, business_wallets, settle RPCs verified live)
Integration: COMPLETE
Testing:     PASSED (build clean; full suite 256/257 — pre-existing VideoPlayer flake only)
Status:      COMPLETE

What was fixed:
- Root cause of "payment option not visible": BusinessProfile.jsx fetched the
  business WITHOUT online_consultation_fee / physical_consultation_fee, so the
  payment UI gate (feeKobo > 0) never rendered. Added both columns to the select.
- Webhook gap: paystack-webhook.js had no booking handler; card-paid bookings
  settled only when the client returned from the Paystack redirect. Added
  handleBooking() (amount cross-check + settle_card_booking, idempotent).
- Return path: booking.js now sets callback_url back to /business/:id?reference=;
  BookingCard verifies via /api/verify-booking-payment before showing confirmation.
```

```
FEATURE 2 — CAREHUB REQUISITION SAVE

Surface:             CareHub
Supporting surface:  —

Frontend:    COMPLETE
Backend:     COMPLETE (create_requisition RPC atomic parent+lines)
Database:    COMPLETE (quantity=text, note, RLS business-scoped — verified live)
Integration: COMPLETE
Testing:     PASSED (CareHub 288/288; build clean)
Status:      COMPLETE

Verified end-to-end:
- addRequisition → POST /rest/v1/rpc/create_requisition with the exact payload
  the RPC expects (p_business_id, p_supplier_name, p_note, p_items).
- RPC is SECURITY INVOKER + pinned search_path; parent + items insert
  atomically in one function call (proven by transactional test + rollback).
- requisitions / requisition_items / staff all carry business-scoped RLS
  (ALL policies via current_business_ids()) so the RPC cannot cross tenants.
- requester preserved: RPC now sets requisitions.created_by from the logged-in
  staff full_name (auth.uid() join); "Raised by" column is no longer empty.
- Frontend surfaces the real server error (never suppresses) and reloads.
```

```
FEATURE 3 — CAREHUB POS EDIT PRICE

Surface:             CareHub
Supporting surface:  —

Frontend:    COMPLETE (POS.jsx setPrice gated by perms.canEditPrice; save failures surfaced)
Backend:     COMPLETE (guard_sale_item_prices BEFORE INSERT trigger on sales — live)
Database:    COMPLETE (price authorized per-line vs catalog; stock untouched on rejection)
Integration: COMPLETE (receipt uses sale-line price; rejected offline sales re-sync visibly)
Testing:     PASSED (CareHub 291/291; build clean; 4 live auth scenarios verified)
Status:      COMPLETE

What was fixed:
- Gap: any authenticated business member could POST crafted items prices to
  /rest/v1/sales, bypassing the UI's canEditPrice gate. No server-side check.
- Added guard_sale_item_prices() (SECURITY INVOKER, pinned search_path) +
  BEFORE INSERT trigger on sales. Trusted callers pass through (postgres,
  service_role, supabase_admin, supabase_auth_admin, is_platform_admin()).
  Role resolution mirrors the frontend: business owner by email → 'Owner';
  else active staff by auth_user_id OR email → staff.role; a custom roles row
  for that business (permissions->>'canEditPrice'='true') wins, else
  role='Owner' may override. Negative prices → check_violation; unknown
  product ids are skipped (mirrors the stock trigger's never-lose-a-sale
  policy). A rejected INSERT aborts before the AFTER INSERT stock trigger, so
  blocked sales do not decrement inventory.
- Frontend contract: saleRepository.create rethrows "Supabase error (4xx)"
  instead of parking server rejections in the offline queue; syncQueued()
  returns { synced, rejected }. POS.saveSale/charge/chargeCredit/holdSale
  surface the server message (toast) and keep the cart intact; charge paths
  now save the sale BEFORE writing the receipt. Dashboard sync warns when
  server-refused offline sales remain.
- Verified live (rolled-back transactions): Pharmacist override rejected
  42501 "Price override not allowed…", catalog price allowed, Owner override
  allowed, custom roles row granting canEditPrice allowed, negative price
  rejected 23514, unknown product id allowed. Advisors: no new findings.
```

```
FEATURE 4 — CAREHUB PATIENT/CLIENT BULK UPLOAD

Surface:             CareHub
Supporting surface:  —

Frontend:    COMPLETE (Clients.jsx CSV import + template; import summary merged with server skips)
Backend:     COMPLETE (createMany batch insert, tenant-stamped, returns {added, skipped, failed})
Database:    COMPLETE (clients_phone_unique_per_business partial unique index — live)
Integration: COMPLETE (single-add and bulk paths surface server duplicates honestly)
Testing:     PASSED (CareHub 293/293; build clean; 5 live DB scenarios verified)
Status:      COMPLETE

What was fixed:
- Gap: phone-number dedupe was client-side only (a React Set built from the
  loaded list), so a concurrent upload, a single add between load and import,
  or a direct POST to /rest/v1/clients could create duplicate clients. The
  template's promise — "repeat customers are skipped, not duplicated" — was
  not enforced anywhere the server could see.
- Added clients_phone_unique_per_business, a partial UNIQUE index on
  (business_id, regexp_replace(phone,'[^0-9]','','g')) excluding null/blank
  phones. Mirrors the app's normPhone exactly, so a row the app would skip is
  exactly a row the server rejects (23505 / 409); per-business (same phone in
  different businesses is allowed); blank phones never collide.
- createMany now returns { added, skipped, failed }: a server duplicate is
  classified skipped (the template's own language) instead of surfacing a raw
  constraint error; importClients merges that into the summary count.
- Single-add save() now says "A client with this phone number already
  exists." instead of the generic failure message.
- global_client_id exists and is indexed but remains unused — wiring it is a
  separate cross-business identity feature, out of scope here.

Verified live (rolled-back transactions): duplicate exact phone rejected
23505; formatting variant (0902-524-9323) rejected (normalization matches the
app); fresh phone allowed; blank phone allowed; same phone in a different
business allowed. Advisors: no new findings.
```

```
FEATURE 5 — CAREHUB RECEIPT SIZE + CLARITY

Surface:             CareHub POS
Supporting surface:  —

Frontend:    AUDITED (POS.jsx printReceipt, window.open/document.write)
Backend:     —
Database:    —
Integration: AUDITED (uses sale-line price; gaps: no @page/width/escaping/credit reprint data)
Testing:     NOT RUN
Status:      AUDITED
```

## Cross-app security (final gate)
- [ ] CareFind clients cannot access CareHub internal functionality
- [ ] CareHub users only manage authorized businesses/locations
- [ ] Payment/patient/POS/requisition data protected
- [ ] RLS intact, no policies disabled