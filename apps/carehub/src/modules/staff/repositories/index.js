import { sbFetch } from '../../../services/supabase'
import { translateConstraintError } from '../../../lib/dbErrors'

// Fifteen tables reference `staff` and none of those foreign keys cascade, so a
// staff member who has done almost anything cannot be deleted. These are the
// reasons, grouped — the exact constraint matters less to the user than what
// they have to do about it.
const DELETE_BLOCKERS = [
  ['rep_territories_staff_id_fkey', 'is assigned to a territory. Unassign them in Territories first.'],
  ['enterprise_locations_manager_staff_id_fkey', 'manages a warehouse. Reassign that location to another manager first.'],
  ['orders_created_by_staff_id_fkey', 'has raised orders. Those records are kept, so this account can be set to inactive but not deleted.'],
  ['orders_approver_staff_id_fkey', 'has approved orders. Those records are kept, so this account can be set to inactive but not deleted.'],
  ['order_watchers_staff_id_fkey', 'is watching an order. Remove them from that order first.'],
  ['internal_messages_sender_staff_id_fkey', 'has sent internal messages, which are kept as a record. Set the account to inactive instead.'],
  ['internal_message_recipients_staff_id_fkey', 'has received internal messages, which are kept as a record. Set the account to inactive instead.'],
  ['field_activities_staff_id_fkey', 'has logged field activity, which is kept as a record. Set the account to inactive instead.'],
  ['activity_comments_staff_id_fkey', 'has commented on field activity, which is kept as a record. Set the account to inactive instead.'],
  ['activity_reactions_staff_id_fkey', 'has reacted to field activity, which is kept as a record. Set the account to inactive instead.'],
  ['activity_viewers_staff_id_fkey', 'is a viewer on field activity. Remove them from those activities first.'],
  ['activity_default_viewers_staff_id_fkey', 'is set as a default activity viewer. Clear that setting first.'],
  ['activity_default_viewers_viewer_staff_id_fkey', 'is set as a default activity viewer. Clear that setting first.'],
  ['staff_claims_staff_id_fkey', 'has a CareFind profile claim against them. Resolve the claim first.'],
  ['staff_notifications_staff_id_fkey', 'has notifications on record. Set the account to inactive instead.'],
]

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
// NOT here on purpose: `loginStaff` / `getStaffByEmail`. Those read `staff`
// before any session exists, as part of authentication, which is a different
// concern from staff management and cannot use a business-scoped repository —
// there is no business yet. They stay in services/supabase.js. (Both are in
// fact now unreachable-by-RLS as anon, since C19 restored scoping on `staff`;
// all 12 active staff have real auth accounts so nothing depends on them. See
// CODE_AUDIT — they are also the last readers of the plaintext password
// columns tracked as C2.)
export function createStaffRepository(request = sbFetch) {
  return {
    // ── Staff ────────────────────────────────────────────────────────────────
    async getAll(businessId) {
      return request(`staff?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    async create(businessId, staff) {
      return request('staff', {
        method: 'POST',
        body: JSON.stringify({ ...staff, business_id: businessId }),
      })
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

    // Previously an id-only DELETE. `name` is only used to build a readable
    // failure message; the page already has the row.
    async delete(staffId, businessId, name = 'This staff member') {
      try {
        return await request(`staff?id=eq.${staffId}&business_id=eq.${businessId}`, {
          method: 'DELETE',
          prefer: 'return=minimal',
        })
      } catch (e) {
        throw translateConstraintError(name, e, DELETE_BLOCKERS)
      }
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
