import { sbFetch } from '../../../services/supabase'

// ── Audit repository ──────────────────────────────────────────────────────────
// Writes the append-only `audit_log` through record_export_audit(), the only
// write path (supabase/migrations/carehub_20261209_record_export_audit.sql).
// The database decides the actor from the caller's session and checks that
// they may export; nothing here can name another actor or skip the check.
//
// recordExport never throws. It returns a status so the caller can apply policy:
//   recorded    the audit row was written
//   refused     the database says this person may not export: do not export
//   unavailable the function is not deployed yet (PGRST202 / 404)
//   failed      anything else (network, expired session, server error)
// Only `refused` is an authorisation answer. The other two mean the record is
// missing, which the caller should surface rather than hide.
//
// Injected transport, same seam as the other repositories.
const REFUSED = /\((401|403)\)|not allowed to export|not an active member/i
const MISSING = /PGRST202|Could not find the function|\(404\)/i

export function createAuditRepository({ request = sbFetch } = {}) {
  return {
    async recordExport(businessId, { exportType, rowCount, filters = {} }) {
      try {
        const id = await request('rpc/record_export_audit', {
          method: 'POST',
          body: JSON.stringify({
            p_business_id: businessId,
            p_export_type: exportType,
            p_row_count: rowCount,
            p_filters: filters,
          }),
        })
        return { status: 'recorded', id }
      } catch (e) {
        const text = String(e && e.message ? e.message : e)
        if (REFUSED.test(text)) return { status: 'refused' }
        if (MISSING.test(text)) return { status: 'unavailable' }
        return { status: 'failed' }
      }
    },
  }
}

export const auditRepository = createAuditRepository()
