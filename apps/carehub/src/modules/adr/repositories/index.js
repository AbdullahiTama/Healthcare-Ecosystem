import { sbFetch, sbUpload } from '../../../services/supabase'
import { ADR_MODULE_TYPES } from '../types'

// ── ADR report repository ────────────────────────────────────────────────────
// Owns the adr_reports aggregate: the report row plus its four child tables
// (products, concomitant meds, reactions, evidence photos). The children have
// no business_id of their own — their RLS derives tenancy through the parent
// report — so every child write is scoped by its primary key AND its report_id,
// which mirrors the live "… via parent report" policies the same way the stock
// repository mirrors the batch/warehouse boundary.
//
// Its only outside dependency is `request` (sbFetch's shape) plus `upload` for
// evidence photos (the adr-evidence storage bucket, a separate system reached
// through a different transport). Tests bind an in-memory adapter / a recording
// adapter; production binds the real PostgREST-backed sbFetch and sbUpload.
export function createAdrReportRepository({ request = sbFetch, upload = sbUpload } = {}) {
  return {
    // ── Report reads ──────────────────────────────────────────────────────────
    async getReports(businessId, filters = {}) {
      let query = 'adr_reports?business_id=eq.' + businessId + '&order=created_at.desc&select=*'
      if (filters.moduleType) query += '&module_type=eq.' + filters.moduleType
      if (filters.status) query += '&status=eq.' + filters.status
      if (filters.search) {
        const q = encodeURIComponent(filters.search)
        query += '&or=(report_number.ilike.*' + q + '*,patient_identifier.ilike.*' + q + '*)'
      }
      if (filters.from) query += '&created_at=gte.' + filters.from
      if (filters.to) query += '&created_at=lte.' + filters.to
      return request(query)
    },

    async getReport(reportId) {
      const rows = await request(`adr_reports?report_id=eq.${reportId}&select=*`)
      return (rows && rows[0]) || null
    },

    // Analytics projection (Phase 2, Item 3): report rows joined with the
    // aggregated is_serious flag, via the security_invoker adr_report_analytics
    // view so RLS still scopes what the caller may see.
    async getAnalytics(businessId) {
      return request(`adr_report_analytics?business_id=eq.${businessId}&select=*`)
    },

    // Loads the aggregate in one pass so the form never has to reassemble it.
    async getReportWithDetails(reportId) {
      const report = await this.getReport(reportId)
      if (!report) return null
      const [products, meds, reactions, photos] = await Promise.all([
        this.getProducts(reportId),
        this.getConcomitantMeds(reportId),
        this.getReactions(reportId),
        this.getEvidencePhotos(reportId),
      ])
      return {
        ...report,
        adr_products: products,
        adr_concomitant_meds: meds,
        adr_reactions: reactions,
        adr_evidence_photos: photos,
      }
    },

    // ── Report writes ─────────────────────────────────────────────────────────
    async createReport(businessId, reportData) {
      return request('adr_reports', {
        method: 'POST',
        body: JSON.stringify({ ...reportData, business_id: businessId }),
        prefer: 'return=representation',
      })
    },

    // Scoped by report_id only: adr_reports has business_id, but the report row
    // carries it and RLS checks it — the stock repo scopes by business_id because
    // that table's children hang off business_id; here the child boundary is the
    // report row, and the report row's own boundary is its report_id + RLS.
    async updateReport(reportId, updates) {
      return request(`adr_reports?report_id=eq.${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Server-side submission gate (submit_adr_report RPC, SECURITY INVOKER).
    // Returns { valid, missing } when the gate fails, or
    // { valid: true, report_id, status, submission_deadline } on success.
    async submitReport(reportId) {
      const rows = await request('rpc/submit_adr_report', {
        method: 'POST',
        body: JSON.stringify({ p_report_id: reportId }),
      })
      return Array.isArray(rows) ? rows[0] : rows
    },

    // ── Products ──────────────────────────────────────────────────────────────
    async getProducts(reportId) {
      return request(`adr_report_products?report_id=eq.${reportId}&order=created_at.asc&select=*`)
    },

    async addProduct(reportId, product) {
      return request('adr_report_products', {
        method: 'POST',
        body: JSON.stringify({ ...product, report_id: reportId }),
        prefer: 'return=representation',
      })
    },

    async updateProduct(productId, reportId, updates) {
      return request(`adr_report_products?product_id=eq.${productId}&report_id=eq.${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    async deleteProduct(productId, reportId) {
      return request(`adr_report_products?product_id=eq.${productId}&report_id=eq.${reportId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // ── Concomitant meds ──────────────────────────────────────────────────────
    async getConcomitantMeds(reportId) {
      return request(`adr_report_concomitant_meds?report_id=eq.${reportId}&order=created_at.asc&select=*`)
    },

    async addConcomitantMed(reportId, med) {
      return request('adr_report_concomitant_meds', {
        method: 'POST',
        body: JSON.stringify({ ...med, report_id: reportId }),
        prefer: 'return=representation',
      })
    },

    async updateConcomitantMed(medId, reportId, updates) {
      return request(`adr_report_concomitant_meds?med_id=eq.${medId}&report_id=eq.${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    async deleteConcomitantMed(medId, reportId) {
      return request(`adr_report_concomitant_meds?med_id=eq.${medId}&report_id=eq.${reportId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // ── Reactions ─────────────────────────────────────────────────────────────
    async getReactions(reportId) {
      return request(`adr_report_reactions?report_id=eq.${reportId}&order=created_at.asc&select=*`)
    },

    async addReaction(reportId, reaction) {
      return request('adr_report_reactions', {
        method: 'POST',
        body: JSON.stringify({ ...reaction, report_id: reportId }),
        prefer: 'return=representation',
      })
    },

    async updateReaction(reactionId, reportId, updates) {
      return request(`adr_report_reactions?reaction_id=eq.${reactionId}&report_id=eq.${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    async deleteReaction(reactionId, reportId) {
      return request(`adr_report_reactions?reaction_id=eq.${reactionId}&report_id=eq.${reportId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // ── Evidence photos ───────────────────────────────────────────────────────
    async getEvidencePhotos(reportId) {
      return request(`adr_report_evidence_photos?report_id=eq.${reportId}&order=created_at.asc&select=*`)
    },

    // Uploads a file to the adr-evidence bucket under a given prefix and
    // returns the public URL. prefix groups the upload (evidence photos vs
    // hospital lab/discharge attachments) while keeping one bucket.
    async uploadAttachment(file, prefix = 'adr-evidence') {
      const ext = (file.name && file.name.split('.').pop()) || 'jpg'
      const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      return upload('adr-evidence', path, file, file.type || 'application/octet-stream', 'Attachment upload failed')
    },

    // Uploads the file to the adr-evidence bucket and returns the public URL.
    async uploadEvidencePhoto(file) {
      return this.uploadAttachment(file, 'adr-evidence')
    },

    async addEvidencePhoto(reportId, photoData) {
      return request('adr_report_evidence_photos', {
        method: 'POST',
        body: JSON.stringify({ ...photoData, report_id: reportId }),
        prefer: 'return=representation',
      })
    },

    async deleteEvidencePhoto(photoId, reportId) {
      return request(`adr_report_evidence_photos?photo_id=eq.${photoId}&report_id=eq.${reportId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // ── Follow-up ─────────────────────────────────────────────────────────────
    async createFollowUp({ businessId, moduleType, followUpOfReportId, createdByUserId, followUpVersionNumber }) {
      return request('adr_reports', {
        method: 'POST',
        body: JSON.stringify({
          business_id: businessId,
          module_type: moduleType,
          status: 'draft',
          follow_up_of_report_id: followUpOfReportId,
          created_by_user_id: createdByUserId || null,
          follow_up_version_number: followUpVersionNumber || null,
        }),
        prefer: 'return=representation',
      })
    },

    // ── Audit trail (Phase 2, Item 5) ─────────────────────────────────────────
    // Lifecycle events (created / status_changed) are written server-side by the
    // trigger on adr_reports; reads are scoped through the same can_access_adr_report
    // RLS the report itself uses, so a reporter sees only their own timeline.
    async getReportEvents(reportId) {
      return request(`adr_report_events?report_id=eq.${reportId}&order=created_at.asc&select=*`)
    },

    // App-initiated events (exported / note) go through the adr_log_event RPC,
    // which is SECURITY DEFINER and re-checks report visibility before writing —
    // the events table deliberately has no client INSERT policy (append-only).
    async logEvent(reportId, eventType, metadata = {}) {
      return request('rpc/adr_log_event', {
        method: 'POST',
        body: JSON.stringify({ p_report_id: reportId, p_event_type: eventType, p_metadata: metadata }),
      })
    },
  }
}

export const adrReportRepository = createAdrReportRepository()

// Maps a CareHub business_type to the ADR module type that drives presentation.
// Enterprise businesses (manufacturer_importer / wholesale) report as `industry` —
// previously the fallback collapsed them to community_pharmacy.
export function getModuleTypeFromBusinessType(businessType) {
  const typeMap = {
    pharmacy: ADR_MODULE_TYPES.COMMUNITY_PHARMACY,
    hospital: ADR_MODULE_TYPES.HOSPITAL,
    industry: ADR_MODULE_TYPES.INDUSTRY,
    manufacturer_importer: ADR_MODULE_TYPES.INDUSTRY,
    wholesale: ADR_MODULE_TYPES.INDUSTRY,
    skincare: ADR_MODULE_TYPES.SKINCARE,
  }
  return typeMap[businessType] || ADR_MODULE_TYPES.COMMUNITY_PHARMACY
}