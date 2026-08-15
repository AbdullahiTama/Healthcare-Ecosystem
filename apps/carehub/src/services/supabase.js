import { authClient } from '../lib/authClient.js'
import { SB_URL, SB_KEY } from '../config/supabase.js'
import { pagedQuery } from '../lib/pagedQuery.js'

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
// C2 (20260813_purge_plaintext_password_columns.sql) dropped businesses.password
// and staff.password, and with them legacy_login_business and the client's
// plaintext login path (loginBusiness/loginStaff). Every account now logs in
// through Supabase Auth: legacy rows were backfilled to confirmed auth users,
// and new accounts get one minted at registration. Login.jsx signs in with
// authClient.auth.signInWithPassword, then resolveAccountByEmail below maps the
// session's email to its business/staff row.
// C20: `select=*` on businesses now fails for anon (password + is_platform_admin
// are revoked), so every businesses read that can run without a session must
// request an explicit safe column list. getBusinessById is anon-reachable
// (Login.jsx:67, the staff-login branch, before any session exists), so it
// excludes both sensitive columns. getBusinessByEmail is only ever called with
// a real session (authenticated retains is_platform_admin), but it still must
// not ask for password.
const BUSINESS_PUBLIC_COLUMNS = 'id,name,owner,email,phone,whatsapp,address,state,city,business_type,hours,maps_link,lat,lng,website,status,visible_on_carefind,created_at,parent_business_id,branch_name,plan,cover_url,enterprise_type,plan_expires_at,location_label,show_price_on_carefind,logo_url,description,latitude,longitude,booking_enabled,booking_type,booking_slots,referring_agent_id,referral_code_used,show_prices,online_consultation_fee,physical_consultation_fee,branch_depth_limit,consultation_medium,consultation_medium_link'
export async function getBusinessById(id) {
  const r = await sbFetch('businesses?id=eq.' + id + '&select=' + BUSINESS_PUBLIC_COLUMNS)
  return r[0] || null
}
// Used once a real Supabase Auth session exists — looks up the matching
// business/staff row by email instead of re-checking a password. Callers read
// is_platform_admin off the result (Login.jsx:32, App.jsx:71), so it is
// included here; password never is.
export async function getBusinessByEmail(email) {
  const r = await sbFetch('businesses?email=eq.' + encodeURIComponent(email) + '&select=' + BUSINESS_PUBLIC_COLUMNS + ',is_platform_admin')
  return r[0] || null
}
export async function getStaffByEmail(email) {
  const r = await sbFetch('staff?email=eq.' + encodeURIComponent(email) + '&status=eq.active&select=*')
  return r[0] || null
}
// Staff.jsx's "add member" auth half, since staff.password was dropped (C2):
// the provision_staff_auth RPC (SECURITY DEFINER, authenticated-only) verifies
// the caller owns the business, then mints a CONFIRMED Supabase Auth user for
// the staff member (or links + confirms an existing account, never overwriting
// its password) and stamps staff.auth_user_id. Returns the auth user id —
// unwrapped the same way as the other scalar RPCs below (activate/deactivate/
// push_master_product), because PostgREST may return a bare value or an array.
export async function provisionStaffAuth(businessId, email, password) {
  const rows = await sbFetch('rpc/provision_staff_auth', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: businessId, p_email: email.toLowerCase(), p_password: password }),
  })
  return Array.isArray(rows) ? rows[0] : rows
}
// Looks up which business/staff row a given email belongs to, once we already
// know (via a real session) that the email is legitimate.
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
// Registration is an RPC, not an INSERT — businesses.password is gone (C2) and
// register_business is the only way to create a business. It runs as SECURITY
// DEFINER so an anon caller can do the two-phase (mint auth user + insert row)
// atomically, and it FORCES status='pending' / is_platform_admin=false /
// parent_business_id=null / plan='basic' regardless of what the payload claims
// — the row it returns has no credential material. p_password is sent as a
// separate argument and consumed by the RPC (it bcrypts it into auth.users);
// it is never written to a table column. Returns the new business id,
// unwrapped like the scalar RPCs.
export async function registerBusiness(data) {
  const { password, ...p_business } = data
  const rows = await sbFetch('rpc/register_business', {
    method: 'POST',
    body: JSON.stringify({ p_business, p_password: password }),
  })
  return Array.isArray(rows) ? rows[0] : rows
}
export async function updateBusiness(id, data) { return sbFetch('businesses?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function getBranches(parentId) { return sbFetch('businesses?parent_business_id=eq.' + parentId + '&select=*') }
export async function addBranch(data) { return sbFetch('businesses', { method: 'POST', body: JSON.stringify(data), prefer: 'return=representation' }) }
// Copies the parent's master-product activations and roles into a newly
// created branch. Called immediately after addBranch so the branch opens with
// the catalog, fees, and permission structure already in place. Stock starts at
// zero — only the activation links are copied, not inventory levels.
export async function cloneBranchData(parentId, branchId) {
  // Activate every master product the parent has, via the RPC — a raw
  // branch_products insert would create an orphan link with no sellable row in
  // the branch's own products table (what Inventory/POS actually read), and
  // was silently failing under RLS anyway. The RPC materialises each product
  // row at stock 0, which is exactly the "opens ready to operate, stock at
  // zero" contract the Locations page promises.
  const masterRows = await sbFetch(`master_products?business_id=eq.${parentId}&select=id`)
  if (masterRows && masterRows.length > 0) {
    await Promise.all(masterRows.map(mp =>
      sbFetch('rpc/activate_branch_product', {
        method: 'POST',
        body: JSON.stringify({ p_branch_id: branchId, p_master_product_id: mp.id, p_override_price: null }),
      }).catch(() => {})
    ))
  }
  // Copy the parent's custom roles.
  const roles = await sbFetch(`roles?business_id=eq.${parentId}&select=name,permissions`)
  if (roles && roles.length > 0) {
    const branchRoles = roles.map(r => ({ business_id: branchId, name: r.name, permissions: r.permissions }))
    await sbFetch('roles', { method: 'POST', body: JSON.stringify(branchRoles), prefer: 'return=minimal' })
  }
}
export async function getAllLocations(mainBusinessId) {
  const main = await getBusinessById(mainBusinessId)
  if (!main) return []
  const parentId = main.parent_business_id || mainBusinessId
  const parent = main.parent_business_id ? await getBusinessById(parentId) : main
  const branches = await getBranches(parentId)
  return parent ? [parent, ...branches] : branches
}

// STAFF
// STAFF — moved to modules/staff/repositories, which scopes the update and
// delete by business_id (both were id-only here). Its six readers — the Staff
// page, Orders, Warehouses, Territories, LiveActivity and Messages — all go
// through that repository now.
//
// `loginStaff` is gone (staff.password was dropped in C2). `getStaffByEmail`
// stays: it resolves the session's email to a staff row after authentication,
// which is a lookup, not a credential check, and cannot use a business-scoped
// repository because Login.jsx calls it before any business context exists.
// `provisionStaffAuth` above covers the new-staff auth half of the Staff page.

// CUSTOM ROLES (the `roles` table — business-defined roles with a
// permissions.jsonb matching lib/permissions.js's preset shapes)
// ROLES — moved to modules/staff/repositories alongside `staff`: a role is the
// permission set a staff member is given, managed on the same page. Both writes
// were id-only here and are now scoped by business_id, which matters because a
// role row carries the permission flags. Read by the Staff page and by
// BusinessDashboard's permission bootstrap.

// PRODUCTS
// `limit=50000` does NOT bypass PostgREST's server-side db-max-rows clamp
// (1000 on this project — proven live 2026-08-11: `Content-Range: 0-999/12276`
// on a limit=50000 request). Only offset-paging through the clamp reaches
// every row, so the products/clients collection reads below page through it.
export async function getProducts(businessId) { return pagedQuery(sbFetch, 'products?business_id=eq.' + businessId + '&order=name.asc,id.asc&select=*') }
export async function searchProducts(businessId, query, limit = 30) {
  const q = encodeURIComponent(query.trim())
  if (!q) return []
  return sbFetch('products?business_id=eq.' + businessId + '&name=ilike.*' + q + '*&order=name.asc&select=id,name,price,category,sku&limit=' + limit)
}
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
// `addSale` is gone (2026-08-15). PharmacyForm — its only caller — now
// dispenses through `saleRepository.create(..., { queueOffline: false })`:
// fail-loud, idempotent on `dispense_ref`, never parked on the offline queue.
// The deliberate decision the old note deferred is made: dispensing is not a
// till and must not replay later.

// CLIENTS
export async function getClients(businessId) { return pagedQuery(sbFetch, 'clients?business_id=eq.' + businessId + '&order=full_name.asc,id.asc&select=*') }
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
export async function addOutOfStock(data) { return sbFetch('out_of_stock', { method: 'POST', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function updateOutOfStock(id, data) { return sbFetch('out_of_stock?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

export async function getCustomerRequests(businessId) { return sbFetch('customer_requests?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addCustomerRequest(data) { return sbFetch('customer_requests', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateCustomerRequest(id, data) { return sbFetch('customer_requests?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

// REQUISITIONS — lines live in `requisition_items` (normalized), not a JSON
// column on `requisitions` (the live table has `note` only; the old payload
// failed every save with 42703). The parent + its lines are written atomically
// by the `create_requisition` RPC (SECURITY INVOKER, tenant-checked by RLS).
export async function getRequisitions(businessId) {
  const reqs = await sbFetch('requisitions?business_id=eq.' + businessId + '&order=created_at.desc&select=*')
  const list = reqs || []
  const ids = list.map(r => r.id)
  if (ids.length === 0) return list
  const items = await sbFetch('requisition_items?requisition_id=in.(' + ids.join(',') + ')&select=*')
  const byReq = {}
  ;(items || []).forEach(it => { (byReq[it.requisition_id] = byReq[it.requisition_id] || []).push(it) })
  return list.map(r => ({ ...r, items: byReq[r.id] || [] }))
}
export async function addRequisition({ business_id, supplier_name, note, items }) {
  return sbFetch('rpc/create_requisition', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: business_id, p_supplier_name: supplier_name, p_note: note || null, p_items: items || [] }),
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  })
}
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

// STAFF CLAIMS — moved to modules/staff/repositories. The read now embeds
// `staff!inner(...)`: without `!inner`, PostgREST applies the
// `staff.business_id` filter to the embedded resource rather than the parent,
// so the old query returned every pending claim in the database with a null
// embed for other businesses'.

// TERRITORIES — moved to modules/territories/repositories, along with the
// `rep_territories` join. `updateTerritory`/`deleteTerritory` were id-only
// PATCH/DELETE and are now scoped by business_id; `removeRepFromTerritory` was
// also id-only and is now scoped by its parent territory, since
// `rep_territories` has no business_id of its own (its RLS derives tenancy
// through the parent, which the repository mirrors). Its three readers — the
// Territories page, Orders and LiveActivity — all go through the repository.

// INTERNAL MESSAGES (official correspondence — To, CC, threaded replies, attachments)
// INTERNAL MESSAGES — moved to modules/messages/repositories, which owns
// `internal_messages` plus its recipients and files, the multi-table `send`
// command and the notification fan-out that follows it (the same three
// injected collaborators `orders` uses: request, upload, notify).
//
// Two scoping fixes went with the move: `getThreadMessages(rootId)` matched on
// `id`/`parent_id` alone with no tenant filter at all — another tenant's root
// id would have returned their whole conversation — and `markMessageRead(id)`
// was an id-only PATCH. Both are scoped there; the child tables have no
// business_id, so their boundary is the parent message, mirroring the live
// "… via parent message" RLS policies.

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
// return=minimal for the same reason as registerBusiness above, and here the
// table is even more clear-cut: agent_applications is a write-only public
// intake queue with no anon SELECT policy at all, so the RETURNING clause
// `return=representation` generates can never pass. Verified against
// production — representation => 42501, minimal => 201.
export async function submitAgentApplication(data) {
  return sbFetch('agent_applications', { method: 'POST', body: JSON.stringify(data), prefer: 'return=minimal' })
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
