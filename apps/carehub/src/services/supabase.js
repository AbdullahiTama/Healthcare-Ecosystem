import { authClient } from '../lib/authClient.js'
import { SB_URL, SB_KEY } from '../config/supabase.js'

// C10 fix: forward the real logged-in session's token when one exists, so
// auth.uid()/auth.email() populate in Postgres (required for RLS, see
// phase2_rls_pilot.sql) — falls back to the anon key otherwise, which is
// the same key every call used unconditionally before this fix, so
// pre-login calls (login itself, duplicate-email checks) are unaffected.
async function authToken() {
  const { data } = await authClient.auth.getSession()
  return data?.session?.access_token || SB_KEY
}

export async function sbFetch(path, options = {}) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    method: options.method || 'GET',
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + await authToken(),
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
    },
    body: options.body || undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try { detail = JSON.parse(text).message || text } catch (e) {}
    throw new Error('Supabase error (' + res.status + '): ' + detail)
  }
  return text ? JSON.parse(text) : []
}

// Shared by the three upload functions below — was previously triplicated
// with the same hardcoded-anon-key header block each copy.
export async function sbUpload(bucket, path, file, contentType, errorLabel) {
  const res = await fetch(SB_URL + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(path), {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + await authToken(),
      'Content-Type': contentType,
    },
    body: file,
  })
  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try { detail = JSON.parse(text).message || text } catch (e) {}
    throw new Error((errorLabel || 'Upload failed') + ' (' + res.status + '): ' + detail)
  }
  return SB_URL + '/storage/v1/object/public/' + bucket + '/' + encodeURIComponent(path)
}

// AUTH
export async function loginBusiness(email, password) {
  const r = await sbFetch('businesses?email=eq.' + encodeURIComponent(email) + '&password=eq.' + encodeURIComponent(password) + '&select=*')
  return r[0] || null
}
export async function loginStaff(email, password) {
  const r = await sbFetch('staff?email=eq.' + encodeURIComponent(email) + '&password=eq.' + encodeURIComponent(password) + '&status=eq.active&select=*')
  return r[0] || null
}
export async function getBusinessById(id) {
  const r = await sbFetch('businesses?id=eq.' + id + '&select=*')
  return r[0] || null
}
// Used once a real Supabase Auth session exists — looks up the matching
// business/staff row by email instead of re-checking a password.
export async function getBusinessByEmail(email) {
  const r = await sbFetch('businesses?email=eq.' + encodeURIComponent(email) + '&select=*')
  return r[0] || null
}
export async function getStaffByEmail(email) {
  const r = await sbFetch('staff?email=eq.' + encodeURIComponent(email) + '&status=eq.active&select=*')
  return r[0] || null
}
// Looks up which business/staff row a given email belongs to, once we already
// know (via a real session or a legacy password match) that the email is legitimate.
export async function resolveAccountByEmail(email) {
  const biz = await getBusinessByEmail(email)
  if (biz) return { biz, staff: null }
  const staff = await getStaffByEmail(email)
  if (staff) {
    const biz2 = await getBusinessById(staff.business_id)
    if (biz2) return { biz: biz2, staff }
  }
  return null
}

// BUSINESSES
export async function getBusinesses() { return sbFetch('businesses?select=*&order=created_at.desc') }
export async function registerBusiness(data) { return sbFetch('businesses', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateBusiness(id, data) { return sbFetch('businesses?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function getBranches(parentId) { return sbFetch('businesses?parent_business_id=eq.' + parentId + '&select=*') }
export async function addBranch(data) { return sbFetch('businesses', { method: 'POST', body: JSON.stringify(data) }) }
export async function getAllLocations(mainBusinessId) {
  const main = await getBusinessById(mainBusinessId)
  if (!main) return []
  const parentId = main.parent_business_id || mainBusinessId
  const parent = main.parent_business_id ? await getBusinessById(parentId) : main
  const branches = await getBranches(parentId)
  return parent ? [parent, ...branches] : branches
}

// STAFF
export async function getStaff(businessId) { return sbFetch('staff?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addStaff(data) { return sbFetch('staff', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateStaff(id, data) { return sbFetch('staff?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function deleteStaff(id) { return sbFetch('staff?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }

// CUSTOM ROLES (the `roles` table — business-defined roles with a
// permissions.jsonb matching lib/permissions.js's preset shapes)
export async function getRoles(businessId) { return sbFetch('roles?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addRole(data) { return sbFetch('roles', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateRole(id, data) { return sbFetch('roles?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function deleteRole(id) { return sbFetch('roles?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }

// PRODUCTS
export async function getProducts(businessId) { return sbFetch('products?business_id=eq.' + businessId + '&order=name.asc&select=*') }
export async function addProduct(data) { return sbFetch('products', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateProduct(id, data) { return sbFetch('products?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function deleteProduct(id) { return sbFetch('products?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }
export async function deleteProductsBulk(ids) {
  if (!ids || ids.length === 0) return
  return sbFetch('products?id=in.(' + ids.join(',') + ')', { method: 'DELETE', prefer: 'return=minimal' })
}

// SALES
// NOTE: `updateSale(id, data)` used to live here — a PATCH on the sales table
// filtered by id alone. POS was its only caller and now goes through
// modules/pos/repositories, which scopes by business_id too, so it was removed
// rather than left as an unscoped write on the money table.
//
// `getSales`/`getTodaySales` have since gone the same way: their readers
// (Reports, DashboardHome, Locations) call saleRepository.getAll/getToday,
// which carry the identical query. Locations imported getSales without ever
// calling it.
//
// `addSale` stays. PharmacyForm is its only caller, and saleRepository.create
// is NOT a drop-in replacement for it: create() parks a failed or offline
// write on the offline queue for later replay, which is correct for a till but
// would be a silent behaviour change for consultation dispensing. Route it
// through the repository when the consultation module adopts the seam and that
// decision can be made deliberately.
export async function addSale(data) { return sbFetch('sales', { method: 'POST', body: JSON.stringify(data) }) }

// CLIENTS
export async function getClients(businessId) { return sbFetch('clients?business_id=eq.' + businessId + '&order=full_name.asc&select=*') }
export async function addClient(data) { return sbFetch('clients', { method: 'POST', body: JSON.stringify(data) }) }
// NOTE: `updateClient(id, data)` used to live here. It PATCHed `clients?id=eq.`
// with no business filter and had zero callers app-wide — same unscoped-write
// class as the removed inventory `updateStock`. Removed; client edits go
// through modules/clients/repositories, which scopes by business_id.
// getClients/addClient stay: six not-yet-migrated modules still import them.
export async function searchClients(businessId, query) {
  return sbFetch('clients?business_id=eq.' + businessId + '&full_name=ilike.*' + encodeURIComponent(query) + '*&select=*')
}

// EXPENSES — all moved to modules/expenses/repositories. `addExpense` and
// `deleteExpense` had been dead since that migration (Expenses.jsx stopped
// calling them and nothing else ever did); `getExpenses` outlived it only
// because Reports still read expenses from here. `deleteExpense` was also an
// id-only DELETE with no business filter — the repository scopes it.

// APPOINTMENTS — all moved to modules/appointments/repositories. Both writes
// were unscoped here: `updateAppointment` filtered on id alone, and
// `deleteAppointment` was an id-only DELETE — destructive, and the one the page
// describes as permanent. The repository scopes both by business_id. Their two
// callers (Appointments, and DashboardHome's schedule panel) use it now.

// DEBTS — moved to modules/debts/repositories. `updateDebt` was the last
// id-only PATCH on a money table; it is scoped by business_id there. Its three
// callers (Debts, POS's credit collection, Purchases' mark-paid) all use the
// repository now, so nothing is left here to be reused unscoped.

// CLIENT HISTORY — moved to modules/clients/repositories, which additionally
// scopes each read by business_id (these filtered on client_id alone).
// getSalesByClient/getAppointmentsByClient/getDebtsByClient had no callers left
// once Clients.jsx migrated, so they were removed rather than left as unscoped
// reads waiting to be reused.

// CONSULTATIONS (skincare & pharmacy forms — 20260803_consultation_forms.sql).
// One shared table `consultation_forms`, discriminated by consultation_type —
// the hospital module owns `consultations` (patient_id-linked), so the two
// workflows never share a table.
// Filters are server-side; `query` matches the client-name snapshot.
export async function getConsultations(businessId, filters = {}) {
  let query = 'consultation_forms?business_id=eq.' + businessId + '&order=consultation_date.desc&select=*'
  if (filters.clientId) query += '&client_id=eq.' + filters.clientId
  if (filters.type) query += '&consultation_type=eq.' + filters.type
  if (filters.query) query += '&client_name=ilike.*' + encodeURIComponent(filters.query) + '*'
  if (filters.from) query += '&consultation_date=gte.' + filters.from
  if (filters.to) query += '&consultation_date=lte.' + filters.to
  return sbFetch(query)
}
// Kept (unlike its sales/appointments/debts siblings) because getLatestConsultation
// below still wraps it for POS. Both filter on client_id alone — POS only ever
// passes an id from its own business-scoped client list, so it is not a live
// leak, but it should take a businessId when POS adopts the repository seam.
export async function getConsultationsByClient(clientId) { return sbFetch('consultation_forms?client_id=eq.' + clientId + '&order=consultation_date.desc&select=*') }
export async function getLatestConsultation(clientId) {
  const data = await getConsultationsByClient(clientId)
  return Array.isArray(data) && data.length ? data[0] : null
}
export async function addConsultation(data) { return sbFetch('consultation_forms', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateConsultation(id, data) { return sbFetch('consultation_forms?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

// DEMAND (out-of-stock book, customer requests, requisitions) — the digital
// replacement for the paper demand log. Tables from
// 20260801_customer_and_requisition_modules.sql.
export async function getOutOfStock(businessId) { return sbFetch('out_of_stock?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addOutOfStock(data) { return sbFetch('out_of_stock', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateOutOfStock(id, data) { return sbFetch('out_of_stock?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

export async function getCustomerRequests(businessId) { return sbFetch('customer_requests?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addCustomerRequest(data) { return sbFetch('customer_requests', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateCustomerRequest(id, data) { return sbFetch('customer_requests?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

export async function getRequisitions(businessId) { return sbFetch('requisitions?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addRequisition(data) { return sbFetch('requisitions', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateRequisition(id, data) { return sbFetch('requisitions?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

// `recordUnderpayment` (the "an underpaid sale or purchase automatically
// creates a debt" rule) moved to modules/debts/repositories — it is a
// debt-domain rule, and its callers in POS and Purchases now reach it there.
// Its contract is unchanged: it never throws, because a failed debt write must
// not undo an already-completed sale or purchase.

// PURCHASES — moved to modules/purchases/repositories, which scopes the update
// by business_id (it was an id-only PATCH here). Reports reads purchases
// through that repository too, so there is no second copy of the query.

// PATIENTS (hospital)
export async function getPatients(businessId, opts = {}) {
  let q = 'patients?business_id=eq.' + businessId + '&order=created_at.desc&select=*'
  if (opts.status) q += '&status=eq.' + opts.status
  if (opts.department) q += '&department=eq.' + encodeURIComponent(opts.department)
  // Global search: matches across every department of the business, not just
  // the caller's own queue (name, reg no, phone, department, assigned doctor).
  if (opts.query) {
    const term = encodeURIComponent(opts.query)
    q += '&or=(full_name.ilike.*' + term + '*,reg_no.ilike.*' + term + '*,phone.ilike.*' + term + '*,department.ilike.*' + term + '*,assigned_doctor.ilike.*' + term + '*)'
  }
  return sbFetch(q)
}
export async function addPatient(data) { return sbFetch('patients', { method: 'POST', body: JSON.stringify(data) }) }
export async function updatePatient(id, data) { return sbFetch('patients?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function getTriage(patientId) { const r = await sbFetch('triage?patient_id=eq.' + patientId + '&select=*'); return r[0] || null }
export async function addTriage(data) { return sbFetch('triage', { method: 'POST', body: JSON.stringify(data) }) }
export async function addHospitalConsultation(data) { return sbFetch('consultations', { method: 'POST', body: JSON.stringify(data) }) }
export async function getPrescriptions(businessId) { return sbFetch('prescriptions?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addPrescription(data) { return sbFetch('prescriptions', { method: 'POST', body: JSON.stringify(data) }) }
export async function updatePrescription(id, data) { return sbFetch('prescriptions?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

// LAB / IMAGING / PATIENT MESSAGES (hospital) — previously 3 duplicate copies
// of these, each hardcoding its own SB_URL/SB_KEY/sbFetch, in Doctor.jsx,
// Lab.jsx, and Imaging.jsx. Consolidated here so credential rotation and any
// future auth changes only need to happen in one place.
export async function addLabRequest(data) { return sbFetch('lab_requests', { method: 'POST', body: JSON.stringify(data) }) }
export async function getLabRequests(businessId) { return sbFetch('lab_requests?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function updateLabRequest(id, data) { return sbFetch('lab_requests?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function getLabResults(requestId) { return sbFetch('lab_results?lab_request_id=eq.' + requestId + '&select=*') }
export async function addLabResult(data) { return sbFetch('lab_results', { method: 'POST', body: JSON.stringify(data) }) }
export async function addImagingRequest(data) { return sbFetch('imaging_requests', { method: 'POST', body: JSON.stringify(data) }) }
export async function getImagingRequests(businessId) { return sbFetch('imaging_requests?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function updateImagingRequest(id, data) { return sbFetch('imaging_requests?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function getPatientMessages(patientId) { return sbFetch('patient_messages?patient_id=eq.' + patientId + '&order=created_at.asc&select=*') }
export async function addPatientMessage(data) { return sbFetch('patient_messages', { method: 'POST', body: JSON.stringify(data) }) }

// SETTINGS — moved to modules/settings/repositories. `saveSettings` was a
// read-then-PATCH-or-POST; it is now a single upsert resolved by the database
// on business_settings' UNIQUE (business_id), which also closes the race where
// two first-time savers both read "no row" and both inserted (the loser got a
// 409 — never corrupt, but a save that failed for no actionable reason).
// Its two callers were Settings.jsx and POS.jsx's receipt printer.

// ADMIN TEAM
export async function getAdminTeam() { return sbFetch('admin_team?select=*&order=created_at.desc') }
export async function addAdminTeam(data) { return sbFetch('admin_team', { method: 'POST', body: JSON.stringify(data) }) }
export async function removeAdminTeam(id) { return sbFetch('admin_team?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }

// NOTIFICATIONS (in-app alerts — who needs to know what, right now)
export async function getMyNotifications(businessId, staffId) {
  const who = staffId
    ? 'staff_id=eq.' + staffId
    : 'is_owner=eq.true'
  return sbFetch('staff_notifications?business_id=eq.' + businessId + '&' + who + '&order=created_at.desc&select=*&limit=50')
}

// Writes one notification row per recipient. Never throws — a failed
// notification must not break the action that triggered it.
export async function notify(businessId, recipients, kind, title, body, link) {
  try {
    if (!recipients || recipients.length === 0) return
    const rows = recipients.map(function (r) {
      return {
        business_id: businessId,
        staff_id: r.staffId || null,
        is_owner: !r.staffId,
        kind: kind,
        title: title,
        body: body || null,
        link: link || null,
      }
    })
    await sbFetch('staff_notifications', { method: 'POST', body: JSON.stringify(rows), prefer: 'return=minimal' })
  } catch (e) {
    // Swallow — the order still went through, the message still sent.
  }
}

export async function markNotificationRead(id) {
  return sbFetch('staff_notifications?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ read_at: new Date().toISOString() }), prefer: 'return=minimal' })
}

export async function markAllNotificationsRead(businessId, staffId) {
  const who = staffId ? 'staff_id=eq.' + staffId : 'is_owner=eq.true'
  return sbFetch('staff_notifications?business_id=eq.' + businessId + '&' + who + '&read_at=is.null', {
    method: 'PATCH',
    body: JSON.stringify({ read_at: new Date().toISOString() }),
    prefer: 'return=minimal',
  })
}

// ENTERPRISE LOCATIONS
// ENTERPRISE LOCATIONS — moved to modules/warehouses/repositories, which scopes
// the update and delete by business_id (both were id-only here). Its three
// readers — the Warehouses page, Stock (which warehouse a batch sits in) and
// Orders (which location an order is raised for) — all go through that
// repository now.
//
// Not to be confused with getAllLocations/getBranches/addBranch above: those
// are the multi-branch `businesses` tree, a different thing entirely.

// STAFF CLAIMS
export async function getStaffClaims(businessId) {
  return sbFetch('staff_claims?select=id,status,created_at,staff_id,staff:staff_id(id,full_name,public_title,business_id)&staff.business_id=eq.' + businessId + '&status=eq.pending')
}
export async function approveStaffClaim(id) { return sbFetch('staff_claims?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }), prefer: 'return=minimal' }) }
export async function rejectStaffClaim(id) { return sbFetch('staff_claims?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }), prefer: 'return=minimal' }) }

// TERRITORIES — moved to modules/territories/repositories, along with the
// `rep_territories` join. `updateTerritory`/`deleteTerritory` were id-only
// PATCH/DELETE and are now scoped by business_id; `removeRepFromTerritory` was
// also id-only and is now scoped by its parent territory, since
// `rep_territories` has no business_id of its own (its RLS derives tenancy
// through the parent, which the repository mirrors). Its three readers — the
// Territories page, Orders and LiveActivity — all go through the repository.

// INTERNAL MESSAGES (official correspondence — To, CC, threaded replies, attachments)
export async function getMessageThreads(businessId) {
  return sbFetch('internal_messages?business_id=eq.' + businessId + '&parent_id=is.null&order=created_at.desc&select=*')
}
export async function getThreadMessages(rootId) {
  return sbFetch('internal_messages?or=(id.eq.' + rootId + ',parent_id.eq.' + rootId + ')&order=created_at.asc&select=*')
}
export async function getMessageRecipients(messageIds) {
  if (!messageIds || messageIds.length === 0) return []
  return sbFetch('internal_message_recipients?message_id=in.(' + messageIds.join(',') + ')&select=*')
}
export async function getMessageFiles(messageIds) {
  if (!messageIds || messageIds.length === 0) return []
  return sbFetch('internal_message_files?message_id=in.(' + messageIds.join(',') + ')&select=*')
}

export async function uploadMessageFile(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = Date.now() + '-' + Math.floor(Math.random() * 100000) + '-' + safeName
  return sbUpload('message-files', path, file, file.type || 'application/octet-stream')
}

export async function sendMessage(message, recipients, files) {
  const rows = await sbFetch('internal_messages', { method: 'POST', body: JSON.stringify(message) })
  const saved = Array.isArray(rows) ? rows[0] : rows
  if (!saved || !saved.id) throw new Error('Message was not saved — no id returned.')
  if (recipients && recipients.length > 0) {
    const payload = recipients.map(function (r) { return { ...r, message_id: saved.id } })
    await sbFetch('internal_message_recipients', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })
  }
  if (files && files.length > 0) {
    const filePayload = files.map(function (f) { return { ...f, message_id: saved.id } })
    await sbFetch('internal_message_files', { method: 'POST', body: JSON.stringify(filePayload), prefer: 'return=minimal' })
  }

  // Tell everyone on the message that it landed.
  if (recipients && recipients.length > 0) {
    const targets = recipients.map(function (r) { return { staffId: r.staff_id } })
    const subject = message.subject || 'a message'
    await notify(
      message.business_id,
      targets,
      'message',
      message.sender_name + ' sent you correspondence',
      subject,
      'messages'
    )
  }

  return saved
}

export async function markMessageRead(recipientRowId) {
  return sbFetch('internal_message_recipients?id=eq.' + recipientRowId, { method: 'PATCH', body: JSON.stringify({ read_at: new Date().toISOString() }), prefer: 'return=minimal' })
}

// STOCK BATCHES & MOVEMENTS — all moved to modules/stock/repositories, which
// owns `stock_batches`, the `stock_movements` journal, and the two multi-step
// operations (transfer, adjust) that must not be reassembled by callers.
// `updateStockBatch` and `deleteStockBatch` were both unscoped here (id-only
// PATCH and id-only DELETE); the repository scopes them by business_id.
//
// `getStockMovements` was NOT carried over: nothing in the app has ever read
// the movement log. It is written on every transfer and adjustment and then
// never surfaced anywhere — a half-built audit trail, not dead leftovers.
// Adding a read method no screen calls would have made the repository
// speculative (the mistake the clients migration had to undo), so the gap is
// recorded in CODE_AUDIT.md as a product decision instead.

// ORDERS & LPO — relocated to modules/orders/repositories (createOrderRepository).

// FIELD ACTIVITY (live rep activity — company-defined fields, voice notes, GPS)
export async function getActivityFields(businessId) {
  return sbFetch('activity_fields?business_id=eq.' + businessId + '&order=sort_order.asc&select=*')
}
export async function addActivityField(data) {
  return sbFetch('activity_fields', { method: 'POST', body: JSON.stringify(data) })
}
export async function updateActivityField(id, data) {
  return sbFetch('activity_fields?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' })
}
export async function deleteActivityField(id) {
  return sbFetch('activity_fields?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' })
}

export async function getDefaultViewers(staffId) {
  if (!staffId) return []
  return sbFetch('activity_default_viewers?staff_id=eq.' + staffId + '&select=*')
}
export async function setDefaultViewers(businessId, staffId, viewers) {
  if (staffId) {
    await sbFetch('activity_default_viewers?staff_id=eq.' + staffId, { method: 'DELETE', prefer: 'return=minimal' })
  }
  if (viewers && viewers.length > 0) {
    const payload = viewers.map(function (v) {
      return { business_id: businessId, staff_id: staffId, viewer_staff_id: v.viewer_staff_id, viewer_name: v.viewer_name }
    })
    await sbFetch('activity_default_viewers', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })
  }
}

export async function getFieldActivities(businessId) {
  return sbFetch('field_activities?business_id=eq.' + businessId + '&order=created_at.desc&select=*&limit=100')
}
export async function getActivityViewers(activityIds) {
  if (!activityIds || activityIds.length === 0) return []
  return sbFetch('activity_viewers?activity_id=in.(' + activityIds.join(',') + ')&select=*')
}
export async function getActivityReactions(activityIds) {
  if (!activityIds || activityIds.length === 0) return []
  return sbFetch('activity_reactions?activity_id=in.(' + activityIds.join(',') + ')&select=*')
}
export async function getActivityComments(activityIds) {
  if (!activityIds || activityIds.length === 0) return []
  return sbFetch('activity_comments?activity_id=in.(' + activityIds.join(',') + ')&order=created_at.asc&select=*')
}

// Turns GPS coordinates into a readable place name.
// Uses OpenStreetMap's free service — no key, no cost.
export async function reverseGeocode(lat, lng) {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&zoom=18&addressdetails=1'
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    if (!data) return null

    const a = data.address || {}
    const parts = []
    if (a.amenity) parts.push(a.amenity)
    else if (a.building) parts.push(a.building)
    else if (a.shop) parts.push(a.shop)
    if (a.road) parts.push(a.road)
    if (a.suburb) parts.push(a.suburb)
    else if (a.neighbourhood) parts.push(a.neighbourhood)
    if (a.city) parts.push(a.city)
    else if (a.town) parts.push(a.town)
    else if (a.state) parts.push(a.state)

    if (parts.length > 0) return parts.join(', ')
    if (data.display_name) return data.display_name
    return null
  } catch (e) {
    return null
  }
}

export async function uploadActivityVoice(blob) {
  const type = blob.type || 'audio/mp4'
  let ext = 'mp4'
  if (type.indexOf('webm') >= 0) ext = 'webm'
  else if (type.indexOf('ogg') >= 0) ext = 'ogg'
  else if (type.indexOf('aac') >= 0) ext = 'aac'
  else if (type.indexOf('mpeg') >= 0) ext = 'mp3'

  const path = 'voice-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '.' + ext
  return sbUpload('activity-voice', path, blob, type, 'Voice upload failed')
}

export async function logActivity(activity, viewers) {
  const rows = await sbFetch('field_activities', { method: 'POST', body: JSON.stringify(activity) })
  const saved = Array.isArray(rows) ? rows[0] : rows
  if (!saved || !saved.id) throw new Error('Activity was not saved — no id returned.')
  if (viewers && viewers.length > 0) {
    const payload = viewers.map(function (v) { return { ...v, activity_id: saved.id } })
    await sbFetch('activity_viewers', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })

    const targets = viewers.map(function (v) { return { staffId: v.staff_id } })
    await notify(
      activity.business_id,
      targets,
      'activity',
      activity.rep_name + ' logged field activity',
      activity.location_label || null,
      'activity'
    )
  }
  return saved
}

export async function reactToActivity(activityId, staffId, actorName) {
  return sbFetch('activity_reactions', { method: 'POST', body: JSON.stringify({
    activity_id: activityId, staff_id: staffId, actor_name: actorName,
  }) })
}
export async function unreactToActivity(reactionId) {
  return sbFetch('activity_reactions?id=eq.' + reactionId, { method: 'DELETE', prefer: 'return=minimal' })
}

// A comment on a rep's activity notifies the rep — that's the whole point of it.
export async function commentOnActivity(data, businessId, repStaffId) {
  const saved = await sbFetch('activity_comments', { method: 'POST', body: JSON.stringify(data) })
  if (businessId && repStaffId && repStaffId !== data.staff_id) {
    await notify(
      businessId,
      [{ staffId: repStaffId }],
      'activity_comment',
      data.actor_name + ' replied to your activity',
      data.body,
      'activity'
    )
  }
  return saved
}

// REFERRAL AGENT PROGRAM (planning/20260802_referral_agent_program_plan.md)
// Agent faces read their own rows through RLS (contact_email match); admin
// faces go through the same table with is_platform_admin() overriding. The
// agent's businesses come ONLY from the get_agent_portfolio() RPC — the
// `businesses` table carries plaintext password columns and must never be
// reachable through an agent session.
export async function getAgentByEmail(email) {
  if (!email) return null
  const r = await sbFetch('agents?contact_email=eq.' + encodeURIComponent(email) + '&select=*')
  return r[0] || null
}
export async function getAgentPortfolio() {
  return sbFetch('rpc/get_agent_portfolio', { method: 'POST' })
}
export async function getAgentCommissions(agentId) {
  return sbFetch('commissions?agent_id=eq.' + agentId + '&order=created_at.desc&select=*')
}
export async function getAgentPayouts(agentId) {
  return sbFetch('payouts?agent_id=eq.' + agentId + '&order=created_at.desc&select=*')
}
export async function getAgentSupportLogs(agentId) {
  return sbFetch('agent_support_logs?agent_id=eq.' + agentId + '&order=created_at.desc&select=*')
}
export async function addAgentSupportLog(data) {
  return sbFetch('agent_support_logs', { method: 'POST', body: JSON.stringify(data) })
}

// Public application form — anon INSERT policy covers this call.
export async function submitAgentApplication(data) {
  return sbFetch('agent_applications', { method: 'POST', body: JSON.stringify(data) })
}

// Admin — application review, agent lifecycle, ledger, payouts, coverage.
export async function getAgentApplications() {
  return sbFetch('agent_applications?order=submitted_at.desc&select=*')
}
export async function reviewAgentApplication(id, patch) {
  return sbFetch('agent_applications?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
}
export async function getAgents() {
  return sbFetch('agents?order=created_at.desc&select=*')
}
export async function addAgentRow(data) {
  return sbFetch('agents', { method: 'POST', body: JSON.stringify(data) })
}
export async function updateAgentRow(id, patch) {
  return sbFetch('agents?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
}
export async function getCommissionsLedger() {
  return sbFetch('commissions?order=created_at.desc&select=*&limit=1000')
}
export async function updateCommission(id, patch) {
  return sbFetch('commissions?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
}
export async function getCommissionReviewFlags() {
  return sbFetch('commission_review_flags?order=created_at.desc&select=*&limit=200')
}
export async function getPayouts() {
  return sbFetch('payouts?order=created_at.desc&select=*')
}
export async function createPayout(payload) {
  return sbFetch('payouts', { method: 'POST', body: JSON.stringify(payload) })
}
export async function updatePayout(id, patch) {
  return sbFetch('payouts?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
}
// Portfolio sizes + at-risk signals for the admin view (admin can read
// businesses directly, unlike an agent).
export async function getBusinessesByAgent(agentId) {
  return sbFetch('businesses?referring_agent_id=eq.' + agentId + '&order=created_at.desc&select=id,name,business_type,plan,plan_expires_at,created_at')
}

// OFFLINE SUPPORT
const CACHE = 'carehub_v1'
export function cacheData(key, data) {
  try { localStorage.setItem(CACHE + '_' + key, JSON.stringify(data)) } catch (e) {}
}
export function getCached(key) {
  try { const d = localStorage.getItem(CACHE + '_' + key); return d ? JSON.parse(d) : null } catch (e) { return null }
}
// The offline sale queue (queueOfflineSale/getOfflineQueue/clearOfflineQueue/
// syncOfflineSales) moved to modules/pos/repositories, where it sits next to
// the sale writes it backs. The localStorage key is unchanged, so sales already
// queued on a device still replay. cacheData/getCached above stay here: they
// cache products for the whole dashboard, not just sales.
