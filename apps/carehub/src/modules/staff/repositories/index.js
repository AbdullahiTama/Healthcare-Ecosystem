import { sbFetch } from '../../../services/supabase'

// ── Staff repository ──────────────────────────────────────────────────────────
// A deep module over the people side of a business: `staff` (who works here),
// `roles` (what a role is allowed to do) and `staff_claims` (a CareFind user
// asserting they are one of these staff members).
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// THREE TABLES, THREE DIFFERENT SCOPING SITUATIONS. Do not assume uniformity
// here — checked against the live schema and pg_policies, not inferred:
//   `staff`         has business_id. Scoped directly.
//   `roles`         has business_id. Scoped directly.
//   `staff_claims`  has NEITHER business_id nor any column reachable from a
//                   PostgREST filter that identifies the tenant — it links a
//                   CareFind user to a staff row, and its RLS derives the
//                   reviewing business through that staff row. So the two
//                   decision writes below are id-only by necessity, and RLS is
//                   the boundary. Documented at the method rather than left to
//                   look like an oversight.
//
// NOT here on purpose: staff *authentication*. Login goes through Supabase
// Auth, and the only auth-adjacent read is `getStaffByEmail` (resolve the
// session's email to a row, post-login) in services/supabase.js, which runs
// from Login.jsx before any business context exists.
export function createStaffRepository(request = sbFetch) {
  return {
    // ── Staff ────────────────────────────────────────────────────────────────
    async getAll(businessId) {
      return request(`staff?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    // Previously an id-only PATCH. Drives the active/inactive toggle and the
    // CareFind visibility toggle.
    async update(staffId, businessId, updates) {
      return request(`staff?id=eq.${staffId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Removes a person completely (remove_staff_member, carehub_20261219_staff_offboarding_and_scope.sql): the
    // staff row, their CareHub-only login and personal data, while the business's sales, payments, shifts, orders and
    // reports stay, unlinked, under the name stored on them. The database decides who may do this; a direct DELETE
    // is refused. Joining is by invitation (modules/staff/services/invitations.js), so there is no create here.
    // → { removed, login_deleted, login_kept }
    async remove(staffId) {
      const res = await request('rpc/remove_staff_member', { method: 'POST', body: JSON.stringify({ p_staff_id: staffId }) })
      return Array.isArray(res) ? res[0] : res
    },

    // ── Roles ────────────────────────────────────────────────────────────────
    async getRoles(businessId) {
      return request(`roles?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    async createRole(businessId, role) {
      return request('roles', {
        method: 'POST',
        body: JSON.stringify({ ...role, business_id: businessId }),
      })
    },

    async updateRole(roleId, businessId, updates) {
      return request(`roles?id=eq.${roleId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    async deleteRole(roleId, businessId) {
      return request(`roles?id=eq.${roleId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // ── CareFind profile claims ──────────────────────────────────────────────
    // Pending claims against this business's staff.
    //
    // `staff!inner(...)` is deliberate and a correction. The previous query
    // embedded `staff:staff_id(...)` and filtered `staff.business_id=eq.X`
    // WITHOUT `!inner` — in PostgREST that filters the embedded resource, not
    // the parent, so it returned every pending claim in the database with a
    // null `staff` embed for other businesses'. `!inner` makes the filter
    // constrain the claims themselves, which is what the call site always
    // assumed. Inert on today's data (2 claims, 0 pending, 1 business) and now
    // also covered server-side by the staff_claims SELECT policy that C19
    // restored — but the query should say what it means.
    async getPendingClaims(businessId) {
      return request(
        'staff_claims?select=id,status,created_at,staff_id,' +
          `staff!inner(id,full_name,public_title,business_id)&staff.business_id=eq.${businessId}` +
          '&status=eq.pending'
      )
    },

    // Id-only by necessity: `staff_claims` carries no tenant column to filter
    // on, and PostgREST cannot filter a PATCH by an embedded resource. The
    // boundary is the table's own RLS policy, "staff_claims approved/rejected
    // only by the reviewing business", which resolves the tenant through the
    // claimed staff row. Ids come from getPendingClaims, which is scoped.
    async decideClaim(claimId, status) {
      return request(`staff_claims?id=eq.${claimId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
        prefer: 'return=minimal',
      })
    },
  }
}

export const staffRepository = createStaffRepository()

// ── Staff activity (owner-only feed) ──────────────────────────────────────────
// One database function, staff_activity(), that refuses everyone but the Owner
// and returns what each person did across sales, refunds, stock, expenses,
// attendance, field visits and shifts. Read-only. The cap is passed so the
// screen can tell the Owner when older rows are not shown.
export const ACTIVITY_LIMIT = 1000

export function createStaffActivityRepository({ request = sbFetch } = {}) {
  return {
    async get(businessId, fromIso, toIso, limit = ACTIVITY_LIMIT) {
      const rows = await request('rpc/staff_activity', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: businessId, p_from: fromIso, p_to: toIso, p_limit: limit }),
      })
      return Array.isArray(rows) ? rows : []
    },
  }
}

export const staffActivityRepository = createStaffActivityRepository()
