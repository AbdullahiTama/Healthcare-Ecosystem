import { supabase as defaultClient } from '../../config/supabaseClient'
import { answerToRow } from './validation.js'

// ── Safety-report repository (CareFind public channel, Phase 2) ────────────
// Reads/writes ONLY the confidential ADR tables + adr-private storage.
// Never touches posts, feed, reviews or any public surface. The server
// (RLS + submit_adr_public_report) re-validates everything; this module maps
// the wizard draft shape onto row columns and nothing more.

const emptyToNull = (v) => (v === '' || v === undefined ? null : v)
const blankToNull = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : v)

function reportRowFromDraft(draft) {
  const r = draft.reporter || {}
  const p = draft.patient || {}
  const extra = draft.extra || {}
  const ageRaw = p.age === 0 || p.age === '0' ? 0 : blankToNull(p.age)
  return {
    reporter_name: blankToNull(r.name),
    reporter_qualification: blankToNull(r.qualification),
    reporter_facility_name: blankToNull(r.facilityName),
    reporter_phone: blankToNull(r.phone),
    reporter_email: blankToNull(r.email),
    reporter_consent_followup: r.consentFollowup ?? null,
    reporter_anonymous_confirmed_by_facility: r.anonymousConfirmed === true,
    patient_identifier: blankToNull(p.identifier),
    patient_gender: blankToNull(p.gender),
    patient_age: ageRaw === null ? null : Number(ageRaw),
    patient_dob: emptyToNull(p.dob),
    patient_age_group: blankToNull(p.ageGroup),
    patient_weight_kg: blankToNull(p.weightKg) === null ? null : Number(p.weightKg),
    patient_medical_history: blankToNull(p.medicalHistory),
    comorbidities: blankToNull(extra.conditions),
    case_narrative_summary: blankToNull(extra.notes),
  }
}

function productRowFromDraft(p) {
  return {
    product_brand_name: p.brandName,
    product_generic_name: blankToNull(p.genericName),
    manufacturer: blankToNull(p.manufacturer),
    batch_lot_number: blankToNull(p.batchLot),
    expiry_date: emptyToNull(p.expiryDate),
    dose: blankToNull(p.dose),
    route: blankToNull(p.route),
    frequency: blankToNull(p.frequency),
    indication: blankToNull(p.indication),
    start_date: emptyToNull(p.startDate),
    stop_date: emptyToNull(p.stopDate),
  }
}

function reactionRowFromDraft(r) {
  return {
    reaction_description: r.description,
    onset_date: emptyToNull(r.onsetDate),
    duration: blankToNull(r.duration),
    severity: blankToNull(r.severity),
    outcome: blankToNull(r.outcome),
    ...answerToRow(r.seriousness || {}),
  }
}

const unwrapSingle = (data) => (Array.isArray(data) ? data[0] : data) || null

export function createSafetyReportRepository(client = defaultClient) {
  const mustAuth = async () => {
    const { data } = await client.auth.getUser()
    const user = data?.user
    if (!user) throw new Error('Sign in to report a side effect.')
    return user
  }

  return {
    async getMyProfile() {
      const user = await mustAuth()
      const { data, error } = await client.from('profiles').select('display_name').eq('id', user.id).single()
      if (error) return { display_name: '' }
      return data || { display_name: '' }
    },

    async createDraft(initial = {}) {
      const user = await mustAuth()
      const { data, error } = await client
        .from('adr_reports')
        .insert({ ...reportRowFromDraft(initial), report_source: 'public', module_type: 'public', status: 'draft', business_id: null, reporter_auth_user_id: user.id })
        .select()
        .single()
      if (error) throw error
      return data
    },

    async getMyDrafts() {
      const user = await mustAuth()
      const { data, error } = await client
        .from('adr_reports')
        .select('report_id, report_number, status, updated_at, created_at')
        .eq('reporter_auth_user_id', user.id)
        .eq('report_source', 'public')
        .eq('status', 'draft')
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getDraftWithDetails(reportId) {
      const [report, products, meds, reactions, photos, routes] = await Promise.all([
        client.from('adr_reports').select('*').eq('report_id', reportId).single(),
        client.from('adr_report_products').select('*').eq('report_id', reportId).order('created_at'),
        client.from('adr_report_concomitant_meds').select('*').eq('report_id', reportId).order('created_at'),
        client.from('adr_report_reactions').select('*').eq('report_id', reportId).order('created_at'),
        client.from('adr_report_evidence_photos').select('*').eq('report_id', reportId).order('created_at'),
        client.from('adr_product_company_routes').select('*').eq('report_id', reportId).order('created_at'),
      ])
      for (const r of [report, products, meds, reactions, photos, routes]) {
        if (r.error) throw r.error
      }
      if (!report.data) return null
      return { ...report.data, products: products.data || [], meds: meds.data || [], reactions: reactions.data || [], photos: photos.data || [], routes: routes.data || [] }
    },

    async updateDraft(reportId, draft) {
      const { data, error } = await client
        .from('adr_reports')
        .update(reportRowFromDraft(draft))
        .eq('report_id', reportId)
        .select()
        .single()
      if (error) throw error
      return data
    },

    async deleteDraft(reportId) {
      const { error } = await client.from('adr_reports').delete().eq('report_id', reportId)
      if (error) throw error
    },

    async saveProduct(reportId, product) {
      const row = { ...productRowFromDraft(product), report_id: reportId }
      if (product.product_id) {
        const { data, error } = await client.from('adr_report_products').update(row).eq('product_id', product.product_id).eq('report_id', reportId).select().single()
        if (error) throw error
        return data
      }
      const { data, error } = await client.from('adr_report_products').insert(row).select().single()
      if (error) throw error
      return data
    },

    async deleteProduct(productId, reportId) {
      const { error } = await client.from('adr_report_products').delete().eq('product_id', productId).eq('report_id', reportId)
      if (error) throw error
    },

    async saveReaction(reportId, reaction) {
      const row = { ...reactionRowFromDraft(reaction), report_id: reportId }
      if (reaction.reaction_id) {
        const { data, error } = await client.from('adr_report_reactions').update(row).eq('reaction_id', reaction.reaction_id).eq('report_id', reportId).select().single()
        if (error) throw error
        return data
      }
      const { data, error } = await client.from('adr_report_reactions').insert(row).select().single()
      if (error) throw error
      return data
    },

    async deleteReaction(reactionId, reportId) {
      const { error } = await client.from('adr_report_reactions').delete().eq('reaction_id', reactionId).eq('report_id', reportId)
      if (error) throw error
    },

    async saveMed(reportId, med) {
      const row = { name: med.name, dose: blankToNull(med.dose), start_date: emptyToNull(med.startDate), end_date: emptyToNull(med.endDate), report_id: reportId }
      if (med.med_id) {
        const { data, error } = await client.from('adr_report_concomitant_meds').update(row).eq('med_id', med.med_id).eq('report_id', reportId).select().single()
        if (error) throw error
        return data
      }
      const { data, error } = await client.from('adr_report_concomitant_meds').insert(row).select().single()
      if (error) throw error
      return data
    },

    async deleteMed(medId, reportId) {
      const { error } = await client.from('adr_report_concomitant_meds').delete().eq('med_id', medId).eq('report_id', reportId)
      if (error) throw error
    },

    async uploadAttachment(reportId, file, caption = '') {
      const user = await mustAuth()
      const ext = (file.name && file.name.split('.').pop()) || 'jpg'
      const path = `${user.id}/${reportId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await client.storage.from('adr-private').upload(path, file, { contentType: file.type || 'image/jpeg' })
      if (uploadError) throw uploadError
      const { data, error } = await client
        .from('adr_report_evidence_photos')
        .insert({ report_id: reportId, evidence_photo_file: path, evidence_photo_type: 'other', evidence_photo_caption: caption || null })
        .select()
        .single()
      if (error) throw error
      return data
    },

    async removeAttachment(photoId, reportId, path) {
      const { error } = await client.from('adr_report_evidence_photos').delete().eq('photo_id', photoId).eq('report_id', reportId)
      if (error) throw error
      if (path) await client.storage.from('adr-private').remove([path])
    },

    async signedAttachmentUrl(path, expiresIn = 3600) {
      const { data, error } = await client.storage.from('adr-private').createSignedUrl(path, expiresIn)
      if (error) throw error
      return data?.signedUrl || null
    },

    async searchCompanies(query, limit = 20) {
      const { data, error } = await client.rpc('search_eligible_product_companies', { p_query: query || null, p_limit: limit })
      if (error) throw error
      return data || []
    },

    async createRoute({ reportId, productId, kind, businessId = null, candidateName = null, idempotencyKey = null }) {
      const { data, error } = await client.rpc('create_adr_product_route', {
        p_report_id: reportId,
        p_product_id: productId,
        p_selection_kind: kind,
        p_responsible_business_id: businessId,
        p_candidate_name: candidateName,
        p_idempotency_key: idempotencyKey,
      })
      if (error) throw error
      return unwrapSingle(data)
    },

    async submit(reportId) {
      const { data, error } = await client.rpc('submit_adr_public_report', { p_report_id: reportId })
      if (error) throw error
      return unwrapSingle(data)
    },
  }
}

export const safetyReportRepository = createSafetyReportRepository()
