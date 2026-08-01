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

async function sbFetch(path, options = {}) {
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
async function sbUpload(bucket, path, file, contentType, errorLabel) {
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
export async function getSales(businessId, filters = {}) {
  let query = 'sales?business_id=eq.' + businessId + '&order=created_at.desc&select=*'
  if (filters.date) query += '&created_at=gte.' + filters.date + 'T00:00:00'
  if (filters.onHold !== undefined) query += '&is_on_hold=eq.' + filters.onHold
  if (filters.isCredit !== undefined) query += '&is_credit=eq.' + filters.isCredit
  return sbFetch(query)
}
export async function addSale(data) { return sbFetch('sales', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateSale(id, data) { return sbFetch('sales?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function getTodaySales(businessId) {
  const today = new Date().toISOString().split('T')[0]
  return sbFetch('sales?business_id=eq.' + businessId + '&created_at=gte.' + today + 'T00:00:00&is_on_hold=eq.false&order=created_at.desc&select=*')
}

// CLIENTS
export async function getClients(businessId) { return sbFetch('clients?business_id=eq.' + businessId + '&order=full_name.asc&select=*') }
export async function addClient(data) { return sbFetch('clients', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateClient(id, data) { return sbFetch('clients?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function searchClients(businessId, query) {
  return sbFetch('clients?business_id=eq.' + businessId + '&full_name=ilike.*' + encodeURIComponent(query) + '*&select=*')
}

// EXPENSES
export async function getExpenses(businessId) { return sbFetch('expenses?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addExpense(data) { return sbFetch('expenses', { method: 'POST', body: JSON.stringify(data) }) }
export async function deleteExpense(id) { return sbFetch('expenses?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }

// APPOINTMENTS
export async function getAppointments(businessId) { return sbFetch('appointments?business_id=eq.' + businessId + '&order=date.asc&select=*') }
export async function addAppointment(data) { return sbFetch('appointments', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateAppointment(id, data) { return sbFetch('appointments?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function deleteAppointment(id) { return sbFetch('appointments?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }

// DEBTS
export async function getDebts(businessId) { return sbFetch('debts?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addDebt(data) { return sbFetch('debts', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateDebt(id, data) { return sbFetch('debts?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

// CLIENT HISTORY (customer database) — every touchpoint a client has had,
// linked through the client_id columns added by
// 20260801_customer_and_requisition_modules.sql.
export async function getSalesByClient(clientId) { return sbFetch('sales?client_id=eq.' + clientId + '&order=created_at.desc&select=*') }
export async function getAppointmentsByClient(clientId) { return sbFetch('appointments?client_id=eq.' + clientId + '&order=date.asc&select=*') }
export async function getDebtsByClient(clientId) { return sbFetch('debts?client_id=eq.' + clientId + '&order=created_at.desc&select=*') }

// CONSULTATIONS (skincare & aesthetic module — 20260803_skincare_consultations.sql).
// Own table `skincare_consultations` — the hospital module owns `consultations`
// (patient_id-linked), so the two workflows never share a table.
// Filters are server-side; `query` matches the client-name snapshot.
export async function getConsultations(businessId, filters = {}) {
  let query = 'skincare_consultations?business_id=eq.' + businessId + '&order=consultation_date.desc&select=*'
  if (filters.clientId) query += '&client_id=eq.' + filters.clientId
  if (filters.query) query += '&client_name=ilike.*' + encodeURIComponent(filters.query) + '*'
  if (filters.from) query += '&consultation_date=gte.' + filters.from
  if (filters.to) query += '&consultation_date=lte.' + filters.to
  return sbFetch(query)
}
export async function getConsultationsByClient(clientId) { return sbFetch('skincare_consultations?client_id=eq.' + clientId + '&order=consultation_date.desc&select=*') }
export async function getLatestConsultation(clientId) {
  const data = await getConsultationsByClient(clientId)
  return Array.isArray(data) && data.length ? data[0] : null
}
export async function addConsultation(data) { return sbFetch('skincare_consultations', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateConsultation(id, data) { return sbFetch('skincare_consultations?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

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

// The "an underpaid sale or purchase automatically creates a debt" rule —
// previously reimplemented independently at all 3 of its call sites (POS.jsx's
// charge() and chargeCredit(), Purchases.jsx's save()), which had already
// drifted (POS always sent due_date '', Purchases sent form.dueDate). One
// definition now, callers pass what varies. Never throws — a failed debt
// write must not undo an already-completed sale or purchase (same contract
// as notify(), and fixes a latent bug in Purchases.jsx's save(), where an
// addDebt failure used to surface as a false "Error saving purchase").
export async function recordUnderpayment({ businessId, direction, partyName, amount, amountPaid, dueDate = '', description, source, sourceRef, clientId = null }) {
  const balance = amount - amountPaid
  if (balance <= 0) return null
  try {
    return await addDebt({
      business_id: businessId,
      client_id: clientId,
      direction,
      party_name: partyName,
      amount,
      amount_paid: amountPaid,
      balance,
      due_date: dueDate,
      status: 'pending',
      description,
      source,
      source_ref: sourceRef,
    })
  } catch (e) {
    return null
  }
}

// PURCHASES
export async function getPurchases(businessId) { return sbFetch('purchases?business_id=eq.' + businessId + '&order=created_at.desc&select=*') }
export async function addPurchase(data) { return sbFetch('purchases', { method: 'POST', body: JSON.stringify(data) }) }
export async function updatePurchase(id, data) { return sbFetch('purchases?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }

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

// SETTINGS
export async function getSettings(businessId) {
  const r = await sbFetch('business_settings?business_id=eq.' + businessId + '&select=*')
  return r[0] || null
}
export async function saveSettings(businessId, data) {
  const existing = await getSettings(businessId)
  if (existing) {
    return sbFetch('business_settings?business_id=eq.' + businessId, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' })
  }
  return sbFetch('business_settings', { method: 'POST', body: JSON.stringify({ ...data, business_id: businessId }) })
}

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
export async function getEnterpriseLocations(businessId) { return sbFetch('enterprise_locations?business_id=eq.' + businessId + '&order=created_at.asc&select=*') }
export async function addEnterpriseLocation(data) { return sbFetch('enterprise_locations', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateEnterpriseLocation(id, data) { return sbFetch('enterprise_locations?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function deleteEnterpriseLocation(id) { return sbFetch('enterprise_locations?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }

// STAFF CLAIMS
export async function getStaffClaims(businessId) {
  return sbFetch('staff_claims?select=id,status,created_at,staff_id,staff:staff_id(id,full_name,public_title,business_id)&staff.business_id=eq.' + businessId + '&status=eq.pending')
}
export async function approveStaffClaim(id) { return sbFetch('staff_claims?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }), prefer: 'return=minimal' }) }
export async function rejectStaffClaim(id) { return sbFetch('staff_claims?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }), prefer: 'return=minimal' }) }

// TERRITORIES
export async function getTerritories(businessId) { return sbFetch('territories?business_id=eq.' + businessId + '&order=created_at.asc&select=*') }
export async function addTerritory(data) { return sbFetch('territories', { method: 'POST', body: JSON.stringify(data) }) }
export async function updateTerritory(id, data) { return sbFetch('territories?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' }) }
export async function deleteTerritory(id) { return sbFetch('territories?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }
export async function getRepAssignments(territoryIds) {
  if (!territoryIds || territoryIds.length === 0) return []
  return sbFetch('rep_territories?territory_id=in.(' + territoryIds.join(',') + ')&select=id,staff_id,territory_id,staff:staff_id(id,full_name,public_title)')
}
export async function assignRepToTerritory(staffId, territoryId) { return sbFetch('rep_territories', { method: 'POST', body: JSON.stringify({ staff_id: staffId, territory_id: territoryId }) }) }
export async function removeRepFromTerritory(id) { return sbFetch('rep_territories?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }) }

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

// STOCK BATCHES (warehouse receiving, expiry, transfers, adjustments)
export async function getStockBatches(businessId) {
  return sbFetch('stock_batches?business_id=eq.' + businessId + '&order=created_at.desc&select=*')
}
export async function addStockBatch(data) {
  return sbFetch('stock_batches', { method: 'POST', body: JSON.stringify(data) })
}
export async function updateStockBatch(id, data) {
  return sbFetch('stock_batches?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' })
}
export async function deleteStockBatch(id) {
  return sbFetch('stock_batches?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' })
}
export async function getStockMovements(businessId) {
  return sbFetch('stock_movements?business_id=eq.' + businessId + '&order=created_at.desc&select=*&limit=100')
}
export async function addStockMovement(data) {
  return sbFetch('stock_movements', { method: 'POST', body: JSON.stringify(data) })
}

export async function transferStock(batch, toLocationId, qty, movedBy) {
  const amount = Number(qty)
  if (!amount || amount <= 0) throw new Error('Enter a quantity greater than zero.')
  if (amount > batch.quantity) throw new Error('You only have ' + batch.quantity + ' units in this batch.')

  if (amount === batch.quantity) {
    await updateStockBatch(batch.id, { location_id: toLocationId })
  } else {
    await updateStockBatch(batch.id, { quantity: batch.quantity - amount })
    await addStockBatch({
      business_id: batch.business_id,
      location_id: toLocationId,
      product_id: batch.product_id,
      product_name: batch.product_name,
      batch_number: batch.batch_number,
      quantity: amount,
      expiry_date: batch.expiry_date,
      date_received: batch.date_received,
      supplier_source: batch.supplier_source,
      storage_location: batch.storage_location,
      status: batch.status,
      received_by: batch.received_by,
    })
  }

  await addStockMovement({
    business_id: batch.business_id,
    batch_id: batch.id,
    from_location_id: batch.location_id,
    to_location_id: toLocationId,
    movement_type: 'transfer',
    quantity: amount,
    reason: null,
    moved_by: movedBy,
  })
}

export async function adjustStock(batch, newQty, reason, movedBy) {
  const amount = Number(newQty)
  if (isNaN(amount) || amount < 0) throw new Error('Enter a valid quantity.')
  const diff = amount - batch.quantity
  await updateStockBatch(batch.id, { quantity: amount })
  await addStockMovement({
    business_id: batch.business_id,
    batch_id: batch.id,
    from_location_id: batch.location_id,
    to_location_id: null,
    movement_type: 'adjustment',
    quantity: diff,
    reason: reason || null,
    moved_by: movedBy,
  })
}

// ORDERS & LPO (rep submits, tagged manager approves, warehouse dispatches)
export async function getOrders(businessId) {
  return sbFetch('orders?business_id=eq.' + businessId + '&order=created_at.desc&select=*')
}
export async function getOrderById(id) {
  const r = await sbFetch('orders?id=eq.' + id + '&select=*')
  return r[0] || null
}
export async function getOrderItems(orderIds) {
  if (!orderIds || orderIds.length === 0) return []
  return sbFetch('order_items?order_id=in.(' + orderIds.join(',') + ')&select=*')
}
export async function getOrderWatchers(orderIds) {
  if (!orderIds || orderIds.length === 0) return []
  return sbFetch('order_watchers?order_id=in.(' + orderIds.join(',') + ')&select=*')
}
export async function getOrderFiles(orderIds) {
  if (!orderIds || orderIds.length === 0) return []
  return sbFetch('order_files?order_id=in.(' + orderIds.join(',') + ')&select=*')
}
export async function getOrderEvents(orderId) {
  return sbFetch('order_events?order_id=eq.' + orderId + '&order=created_at.asc&select=*')
}
export async function addOrderEvent(data) {
  return sbFetch('order_events', { method: 'POST', body: JSON.stringify(data) })
}

export async function uploadOrderFile(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = Date.now() + '-' + Math.floor(Math.random() * 100000) + '-' + safeName
  return sbUpload('order-files', path, file, file.type || 'application/octet-stream')
}

export async function createOrder(order, items, watchers, files) {
  const rows = await sbFetch('orders', { method: 'POST', body: JSON.stringify(order) })
  const saved = Array.isArray(rows) ? rows[0] : rows
  if (!saved || !saved.id) throw new Error('Order was not saved — no id returned.')

  if (items && items.length > 0) {
    const payload = items.map(function (i) { return { ...i, order_id: saved.id } })
    await sbFetch('order_items', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })
  }
  if (watchers && watchers.length > 0) {
    const payload = watchers.map(function (w) { return { ...w, order_id: saved.id } })
    await sbFetch('order_watchers', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })
  }
  if (files && files.length > 0) {
    const payload = files.map(function (f) { return { ...f, order_id: saved.id } })
    await sbFetch('order_files', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })
  }

  await addOrderEvent({
    order_id: saved.id,
    event_type: 'submitted',
    note: null,
    actor_name: order.created_by_name,
  })

  // The approver needs to act. Everyone copied just needs to know.
  await notify(
    order.business_id,
    [{ staffId: order.approver_staff_id }],
    'order_approval',
    'Order needs your approval',
    order.created_by_name + ' raised an order for ' + order.customer_name,
    'orders'
  )

  if (watchers && watchers.length > 0) {
    const cc = watchers.map(function (w) { return { staffId: w.staff_id } })
    await notify(
      order.business_id,
      cc,
      'order_copy',
      'You were copied on an order',
      order.created_by_name + ' raised an order for ' + order.customer_name,
      'orders'
    )
  }

  return saved
}

export async function advanceOrder(orderId, status, extra, actorName, note) {
  const patch = { status: status }
  if (extra) {
    const keys = Object.keys(extra)
    for (let i = 0; i < keys.length; i++) { patch[keys[i]] = extra[keys[i]] }
  }
  await sbFetch('orders?id=eq.' + orderId, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
  await addOrderEvent({
    order_id: orderId,
    event_type: status,
    note: note || null,
    actor_name: actorName,
  })

  // Tell the rep who raised it, and everyone copied.
  try {
    const order = await getOrderById(orderId)
    if (order) {
      const watchers = await getOrderWatchers([orderId])
      const targets = [{ staffId: order.created_by_staff_id }]
      ;(watchers || []).forEach(function (w) {
        targets.push({ staffId: w.staff_id })
      })

      const labels = {
        approved: 'Order approved',
        rejected: 'Order rejected',
        processing: 'Order sent to warehouse',
        dispatched: 'Order dispatched',
        delivered: 'Order delivered',
      }

      await notify(
        order.business_id,
        targets,
        'order_update',
        labels[status] || 'Order updated',
        actorName + ' — ' + order.customer_name + (note ? ' · ' + note : ''),
        'orders'
      )
    }
  } catch (e) {}
}

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

// OFFLINE SUPPORT
const CACHE = 'carehub_v1'
export function cacheData(key, data) {
  try { localStorage.setItem(CACHE + '_' + key, JSON.stringify(data)) } catch (e) {}
}
export function getCached(key) {
  try { const d = localStorage.getItem(CACHE + '_' + key); return d ? JSON.parse(d) : null } catch (e) { return null }
}
export function queueOfflineSale(sale) {
  try {
    const q = JSON.parse(localStorage.getItem(CACHE + '_offline_sales') || '[]')
    q.push({ ...sale, _offline_id: Date.now() })
    localStorage.setItem(CACHE + '_offline_sales', JSON.stringify(q))
  } catch (e) {}
}
export function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(CACHE + '_offline_sales') || '[]') } catch (e) { return [] }
}
export function clearOfflineQueue() {
  try { localStorage.removeItem(CACHE + '_offline_sales') } catch (e) {}
}
export async function syncOfflineSales(businessId) {
  if (!navigator.onLine) return 0
  const queue = getOfflineQueue()
  if (!queue.length) return 0
  let count = 0
  for (const sale of queue) {
    try {
      const { _offline_id, ...data } = sale
      await addSale({ ...data, business_id: businessId })
      count++
    } catch (e) {}
  }
  if (count > 0) clearOfflineQueue()
  return count
}
