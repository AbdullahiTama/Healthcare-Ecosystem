# Appointment Booking Feature — Spec Conformance Review

**Date:** 2026-08-31
**Spec:** CareFind Appointment Booking Feature (Developer Implementation Specification v1.0)
**Status:** Partially conformant — significant gaps in Phases 4-5

---

## Executive Summary

The implementation covers **Phases 1-3** (Services, Availability, Booking & Payment) reasonably well. However, **Phases 4-5** (Wallet & Confirmation, Policies & Hardening) have critical gaps that prevent the feature from being production-ready per the spec.

**Conformance Score: ~60%**

---

## Section-by-Section Gap Analysis

### §2. Core User Roles
| Requirement | Status | Notes |
|-------------|--------|-------|
| Business Owner: Create/edit/activate/deactivate services | ✅ Done | Settings.jsx services CRUD |
| Business Owner: Set price per service | ✅ Done | price_kobo field |
| Business Owner: Create appointment time slots | ✅ Done | service_availability table |
| Business Owner: View available/booked slots | ✅ Done | Settings.jsx availability UI |
| Business Owner: View incoming appointments | ✅ Done | Appointments.jsx |
| Business Owner: Confirm completed appointments | ⚠️ Partial | confirm RPC exists but flow is confirm→complete (spec says confirm=fulfilled) |
| Business Owner: View pending/available revenue | ✅ Done | Wallet display in Appointments.jsx |
| Business Owner: Withdraw only available funds | ✅ Done | request_business_withdrawal RPC |
| Patient: View active services | ✅ Done | BusinessProfile.jsx |
| Patient: Select service & view available slots | ✅ Done | BookingCard |
| Patient: Pay through payment gateway | ✅ Done | Paystack integration |
| Patient: Receive booking confirmation | ⚠️ Partial | Notification exists but no email/SMS |
| Patient: View appointment status | ❌ Missing | No patient-facing appointment list |

### §3. Service Management
| Requirement | Status | Notes |
|-------------|--------|-------|
| Service fields (id, business_owner_id, name, price, is_active, created_at, updated_at) | ✅ Done | business_services table |
| Add Service: name + price | ✅ Done | |
| Edit Service: change name/price | ✅ Done | |
| Price changes apply only to future bookings | ✅ Done | fee_amount snapshot in appointments |
| Delete Service: soft delete/deactivation | ✅ Done | is_active toggle |
| Inactive services not shown to patients | ✅ Done | RLS policy + booking.js check |
| Validate name present, price non-negative | ⚠️ Partial | Frontend validation exists; DB constraint missing (price_kobo >= 0 not enforced) |

### §4. Time Slot Management
| Requirement | Status | Notes |
|-------------|--------|-------|
| Slot fields (id, business_owner_id, service_id, date, start_time, end_time, status, appointment_id) | ⚠️ Partial | service_availability has `time` but no `end_time` column; spec requires start_time + end_time |
| Reject end_time <= start_time | ❌ Missing | No end_time validation |
| Prevent overlapping slots for same business/service | ⚠️ Partial | UNIQUE constraint on (business_id, service_id, date, time) but no time-range overlap check |
| Booked slot cannot be deleted | ✅ Done | UI hides delete button for booked slots |
| Slot bookable only when active + service active | ✅ Done | booking.js checks both |
| Prevent booking slots in the past | ✅ Done | booking.js validates date >= today |
| Concurrent booking protection | ⚠️ Partial | book_appointment_slot RPC uses FOR UPDATE but STABLE (not VOLATILE) — transaction isolation may be insufficient |

### §5. Patient Booking Flow
| Requirement | Status | Notes |
|-------------|--------|-------|
| 1. Open business profile | ✅ Done | |
| 2. Retrieve active services | ✅ Done | |
| 3. Select service | ✅ Done | |
| 4. Retrieve available slots for service | ✅ Done | |
| 5. Select slot | ✅ Done | |
| 6. Review screen (biz name, service, date, time, price) | ⚠️ Partial | BusinessProfile has basic review but missing some fields |
| 7. Pay Now | ✅ Done | |
| 8. Payment gateway | ✅ Done | Paystack |
| 9. Backend verifies payment server-side | ✅ Done | verify-booking-payment.js |
| 10. Appointment created + slot atomically booked | ⚠️ Partial | RPC exists but STABLE volatility issue |
| 11. Wallet transaction created (pending) | ❌ Missing | settle_card_booking credits wallet but no pending status — goes straight to held_balance |
| 12. Booking confirmation + visible in lists | ⚠️ Partial | Notification to business only; no patient confirmation |

### §6. Booking Atomicity & Double-Booking Protection
| Requirement | Status | Notes |
|-------------|--------|-------|
| Don't rely only on frontend checks | ✅ Done | Server-side validation |
| DB transaction + row-level locking | ⚠️ Partial | FOR UPDATE used but function is STABLE not VOLATILE |
| Re-check slot status before final booking | ✅ Done | RPC checks status + is_booked |
| Fail cleanly if slot already taken | ✅ Done | 409 mapping |
| Payment verification + appointment creation atomic | ❌ Missing | Payment verify and appointment creation are separate operations |
| Unique DB constraints | ✅ Done | UNIQUE on service_availability; unique index on appointments |

### §7. Appointment Data Model
| Requirement | Status | Notes |
|-------------|--------|-------|
| id, patient_id, business_owner_id, service_id, timeslot_id | ⚠️ Partial | No `timeslot_id` column in appointments; service_id exists |
| status | ✅ Done | |
| amount, payment_reference | ✅ Done | |
| created_at, confirmed_at, cancelled_at, completed_at | ⚠️ Partial | cancelled_at exists; confirmed_at set on confirm; completed_at added recently |
| notes/reason | ✅ Done | |

### §8. Payment and Wallet Logic
| Requirement | Status | Notes |
|-------------|--------|-------|
| Revenue not immediately withdrawable | ⚠️ Partial | fn_credit_business_booking credits held_balance (not available), but spec wants explicit "pending" status |
| Patient pays → payment gateway confirms | ✅ Done | |
| System creates appointment as pending | ✅ Done | |
| System creates wallet transaction with status=pending | ❌ Missing | No wallet_transactions table; business_wallets has held_balance/available_balance but no transaction ledger |
| Amount in pending balance (not withdrawable) | ✅ Done | held_balance is separate from available_balance |
| Owner confirms → wallet transaction changes pending→confirmed | ❌ Missing | No wallet_transactions status field; confirmation moves held→available directly |
| Amount becomes available for withdrawal | ✅ Done | complete_appointment_and_release RPC |

### §8.2 Wallet Transaction Fields
| Requirement | Status | Notes |
|-------------|--------|-------|
| id, business_owner_id, appointment_id | ❌ Missing | No wallet_transactions table |
| transaction_type, amount, status | ❌ Missing | |
| notes, created_at, updated_at | ❌ Missing | |

### §8.3 Balance Calculation
| Requirement | Status | Notes |
|-------------|--------|-------|
| Pending balance = sum of pending transactions | ⚠️ Partial | held_balance serves this purpose but no ledger |
| Available balance = confirmed - refunds - withdrawals | ⚠️ Partial | available_balance exists but no ledger derivation |
| Don't treat cached balance as source of truth | ❌ Missing | business_wallets uses direct balance fields, not ledger-derived |

### §9. Confirm Appointment
| Requirement | Status | Notes |
|-------------|--------|-------|
| Verify logged-in owner owns appointment | ✅ Done | RPC + business_id check |
| Verify appointment eligible for confirmation | ✅ Done | Checks status = 'pending' |
| Update appointment status to confirmed + confirmed_at | ✅ Done | confirm_appointment RPC |
| Update linked wallet transaction pending→confirmed | ⚠️ Partial | Moves held→available directly; no wallet_transactions record |
| Atomic operation | ⚠️ Partial | confirm_appointment uses a transaction but the wallet move is direct balance update, not ledger entry |
| Return updated appointment + wallet balance | ✅ Done | Frontend refreshes both |

### §10. Cancellation, No-Show, Refund, Rescheduling
| Requirement | Status | Notes |
|-------------|--------|-------|
| Cancellation policy | ❌ Missing | Cancel button exists but no slot release, no refund logic |
| No-show policy | ❌ Missing | |
| Rescheduling | ❌ Missing | |
| Refunds in financial ledger | ❌ Missing | No ledger exists |

### §11. Notifications
| Requirement | Status | Notes |
|-------------|--------|-------|
| Booking confirmation to patient | ❌ Missing | Only business gets notification |
| New appointment notification to business | ✅ Done | staff_notifications insert |
| Appointment reminder to patient | ❌ Missing | |
| Confirmation notification to patient | ❌ Missing | |
| Cancellation/refund notification | ❌ Missing | |

### §12. Business Owner Dashboard
| Requirement | Status | Notes |
|-------------|--------|-------|
| Appointments section | ✅ Done | |
| Services management (list, add, edit, deactivate) | ✅ Done | Settings.jsx |
| Time-slot management | ✅ Done | Settings.jsx availability |
| Visual distinction available vs booked | ✅ Done | Color coding + strikethrough |
| Appointments list with patient, service, date/time, amount, status | ✅ Done | DataTable columns |
| Pending appointments with confirmation action | ✅ Done | Confirm button |
| Wallet summary (pending, available, total) | ✅ Done | Wallet card in Appointments |
| Transaction history | ❌ Missing | No transaction list view |
| Filters for status/date | ⚠️ Partial | Status filter exists; no date filter |

### §13. Patient-Facing Requirements
| Requirement | Status | Notes |
|-------------|--------|-------|
| Business profile shows book button when enabled | ✅ Done | |
| Display only active services | ✅ Done | |
| Display current service price | ✅ Done | |
| Show only available slots for selected service | ✅ Done | |
| Booked/unavailable slots not selectable | ✅ Done | |
| Clear booking summary before payment | ⚠️ Partial | Basic review in BookingCard |
| Booking reference after payment | ⚠️ Partial | Shows confirmation but no reference number |
| Patient can find appointment later | ❌ Missing | No patient appointment history |

### §14. API Requirements
| Endpoint | Status | Notes |
|----------|--------|-------|
| POST /api/services | ⚠️ Partial | Via supabase.js, not REST API |
| GET /api/services | ⚠️ Partial | Via supabase.js |
| PATCH /api/services/:id | ⚠️ Partial | Via supabase.js |
| DELETE /api/services/:id | ⚠️ Partial | Via supabase.js (soft delete) |
| GET /api/businesses/:id/services | ⚠️ Partial | Via supabase.js |
| POST /api/timeslots | ⚠️ Partial | Via supabase.js |
| GET /api/timeslots | ⚠️ Partial | Via supabase.js |
| DELETE /api/timeslots/:id | ⚠️ Partial | Via supabase.js |
| GET /api/services/:id/timeslots/available | ⚠️ Partial | Via supabase.js |
| POST /api/appointments | ✅ Done | booking.js handler |
| GET /api/appointments | ⚠️ Partial | Via supabase.js |
| GET /api/appointments/:id | ❌ Missing | No single appointment endpoint |
| POST /api/appointments/:id/confirm | ✅ Done | confirm_appointment RPC |
| POST /api/appointments/:id/cancel | ⚠️ Partial | Frontend only, no slot release |
| POST /api/appointments/:id/reschedule | ❌ Missing | |
| GET /api/wallet | ⚠️ Partial | Direct table read |
| GET /api/wallet/transactions | ❌ Missing | No transactions endpoint |

### §15. Database Integrity and Security
| Requirement | Status | Notes |
|-------------|--------|-------|
| Every owner endpoint verifies ownership | ✅ Done | RLS + business_id checks |
| Patients access only own appointments | ⚠️ Partial | No patient auth on CareFind bookings |
| Never trust frontend price | ✅ Done | Server reads from business_services |
| Never mark paid from frontend callback | ✅ Done | verify-booking-payment.js |
| Verify payment with provider | ✅ Done | Paystack verification |
| Idempotency for payment webhooks | ⚠️ Partial | payment_reference unique but no explicit idempotency check |
| Never delete financial transactions | ❌ Missing | No financial transaction records exist |
| Audit trail for status changes | ❌ Missing | No audit log |
| DB transactions for multi-record ops | ⚠️ Partial | book_appointment_slot uses transaction; confirm uses transaction |

### §16. Database Relationships
| Relationship | Status | Notes |
|-------------|--------|-------|
| businesses → services | ✅ Done | business_services.business_id |
| services → appointment_timeslots | ✅ Done | service_availability.service_id |
| appointments → patient | ⚠️ Partial | client_name/client_id but no patient auth |
| appointments → service | ✅ Done | appointments.service_id |
| appointments → timeslot | ❌ Missing | No timeslot_id in appointments |
| wallet_transactions → appointment | ❌ Missing | No wallet_transactions table |

---

## Critical Gaps (Must Fix Before Production)

### 1. No Wallet Transaction Ledger (§8.2, §8.3, §15)
**Impact:** HIGH — Cannot audit financial history, cannot derive balances reliably
**Fix:** Create `wallet_transactions` table with id, business_id, appointment_id, transaction_type, amount, status, notes, created_at. Derive balances from ledger.

### 2. book_appointment_slot is STABLE not VOLATILE (§4, §6)
**Impact:** HIGH — May not provide proper transaction isolation for concurrent bookings
**Fix:** Change function volatility to VOLATILE (or at minimum IMMUTABLE is wrong — it modifies data)

### 3. No Patient-Side Features (§13, §2.2)
**Impact:** MEDIUM — Patients cannot view their appointment history or receive confirmations
**Fix:** Add patient appointment list view, booking confirmation notification

### 4. No Cancellation/Refund Logic (§10)
**Impact:** MEDIUM — Cancel button exists but doesn't release slot or process refund
**Fix:** Implement slot release on cancellation, add refund policy hooks

### 5. No end_time in service_availability (§4.1)
**Impact:** MEDIUM — Cannot enforce duration or prevent overlapping time ranges
**Fix:** Add end_time column, validate end > start, check range overlaps

### 6. Missing wallet_transactions table (§8.2)
**Impact:** HIGH — No audit trail for financial operations
**Fix:** Create table, migrate existing held/available balance to ledger entries

### 7. No idempotency enforcement (§15)
**Impact:** MEDIUM — Duplicate webhooks could create duplicate entries
**Fix:** Add explicit idempotency check on payment_reference before appointment creation

---

## Recommended Action Plan

### Phase A: Critical Fixes (1-2 days)
1. Fix book_appointment_slot volatility (STABLE → VOLATILE)
2. Add end_time column to service_availability
3. Create wallet_transactions table
4. Add timeslot_id column to appointments

### Phase B: Wallet Ledger (2-3 days)
1. Create wallet_transactions table with proper schema
2. Migrate existing held_balance/available_balance to ledger entries
3. Update confirm_appointment to write ledger entry
4. Update complete_appointment_and_release to write ledger entry
5. Add GET /api/wallet/transactions endpoint

### Phase C: Patient Features (1-2 days)
1. Add patient appointment lookup (by phone + business)
2. Add booking confirmation notification to patient
3. Add appointment status view for patients

### Phase D: Policies & Hardening (2-3 days)
1. Implement cancellation with slot release
2. Add refund policy hooks (product approval needed)
3. Add audit trail for status changes
4. Add date filter to appointment list
5. Add single appointment endpoint (GET /api/appointments/:id)

---

## What's Already Good

- Service CRUD with soft-delete ✅
- Atomic booking with RPC ✅
- Paystack integration ✅
- Business owner dashboard with wallet display ✅
- Status flow (pending → confirmed → completed) ✅
- RLS policies for tenant isolation ✅
- Price snapshot in fee_amount ✅
- Booking notification to business ✅
