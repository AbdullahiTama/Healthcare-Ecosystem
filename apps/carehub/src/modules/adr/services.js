import { sbFetch, sbUpload } from '../../services/supabase'
import { 
  ADR_MODULE_TYPES, 
  REPORT_STATUS, 
  REACTION_SEVERITY, 
  REACTION_OUTCOME, 
  ACTION_TAKEN, 
  DECHALLENGE, 
  RECHALLENGE, 
  CAUSALITY, 
  REACTION_EXPECTED, 
  EVIDENCE_PHOTO_TYPE, 
  QUALIFICATIONS, 
  PATIENT_GENDER, 
  PATIENT_AGE_GROUP 
} from './types'

// Report APIs
export async function createAdrReport(reportData) {
  return sbFetch('adr_reports', {
    method: 'POST',
    body: JSON.stringify(reportData),
    prefer: 'return=representation',
  })
}

export async function getAdrReports(businessId, filters = {}) {
  let query = 'adr_reports?business_id=eq.' + businessId + '&order=created_at.desc&select=*'

  if (filters.moduleType) query += '&module_type=eq.' + filters.moduleType
  if (filters.status) query += '&status=eq.' + filters.status
  if (filters.search) {
    const q = encodeURIComponent(filters.search)
    query += `(or(report_number.ilike.*${q}*,created_by_user_id.ilike.*${q}*))`
  }
  if (filters.from) query += '&created_at=gte.' + filters.from
  if (filters.to) query += '&created_at=lte.' + filters.to

  return sbFetch(query)
}

export async function getAdrReport(reportId) {
  return sbFetch(`adr_reports?id=eq.${reportId}&select=*`)
}

export async function updateAdrReport(reportId, data) {
  return sbFetch(`adr_reports?id=eq.${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    prefer: 'return=minimal',
  })
}

export async function submitAdrReport(reportId) {
  return sbFetch(`adr_reports?id=eq.${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: REPORT_STATUS.SUBMITTED }),
    prefer: 'return=minimal',
  })
}

export async function exportAdrReport(reportId, format = 'pdf') {
  return sbFetch(`adr_reports?id=eq.${reportId}/export?format=${format}`, {
    method: 'POST',
    body: JSON.stringify({ format }),
    prefer: 'return=representation',
  })
}

// Product APIs
export async function createAdrProduct(productData) {
  return sbFetch('adr_report_products', {
    method: 'POST',
    body: JSON.stringify(productData),
    prefer: 'return=representation',
  })
}

export async function getAdrProducts(reportId) {
  return sbFetch(`adr_report_products?report_id=eq.${reportId}&select=*`)
}

export async function updateAdrProduct(productId, data) {
  return sbFetch(`adr_report_products?id=eq.${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    prefer: 'return=minimal',
  })
}

export async function deleteAdrProduct(productId) {
  return sbFetch(`adr_report_products?id=eq.${productId}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  })
}

// Concomitant medication APIs
export async function createAdrConcomitantMeds(medsData) {
  return sbFetch('adr_report_concomitant_meds', {
    method: 'POST',
    body: JSON.stringify(medsData),
    prefer: 'return=representation',
  })
}

export async function getAdrConcomitantMeds(reportId) {
  return sbFetch(`adr_report_concomitant_meds?report_id=eq.${reportId}&select=*`)
}

// Reaction APIs
export async function createAdrReaction(reactionData) {
  return sbFetch('adr_report_reactions', {
    method: 'POST',
    body: JSON.stringify(reactionData),
    prefer: 'return=representation',
  })
}

export async function getAdrReactions(reportId) {
  return sbFetch(`adr_report_reactions?report_id=eq.${reportId}&select=*`)
}

export async function updateAdrReaction(reactionId, data) {
  return sbFetch(`adr_report_reactions?id=eq.${reactionId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    prefer: 'return=minimal',
  })
}

// Evidence photo APIs
export async function uploadAdrPhoto(bucket, path, file, contentType) {
  return sbUpload(bucket, path, file, contentType, 'Evidence photo upload failed')
}

export async function createAdrEvidencePhoto(photoData) {
  return sbFetch('adr_report_evidence_photos', {
    method: 'POST',
    body: JSON.stringify(photoData),
    prefer: 'return=representation',
  })
}

export async function getAdrEvidencePhotos(reportId) {
  return sbFetch(`adr_report_evidence_photos?report_id=eq.${reportId}&select=*`)
}

// Deadline calculation
export function calculateDeadline(reportCreatedAt, isSerious, reactionExpected, newSafetySignal) {
  if (newSafetySignal) {
    return new Date(reportCreatedAt.getTime() + 3 * 24 * 60 * 60 * 1000) // 3 days
  }

  if (isSerious && !reactionExpected) {
    return new Date(reportCreatedAt.getTime() + 72 * 60 * 60 * 1000) // 72 hours
  }

  if (isSerious && reactionExpected) {
    return new Date(reportCreatedAt.getTime() + 15 * 24 * 60 * 60 * 1000) // 15 days
  }

  if (!isSerious && !reactionExpected) {
    return new Date(reportCreatedAt.getTime() + 15 * 24 * 60 * 60 * 1000) // 15 days
  }

  if (!isSerious && reactionExpected) {
    return new Date(reportCreatedAt.getTime() + 90 * 24 * 60 * 60 * 1000) // 90 days
  }

  // Fallback
  return new Date(reportCreatedAt.getTime() + 15 * 24 * 60 * 60 * 1000)
}

export function getDeadlineStatus(deadline) {
  const now = new Date()
  const diffMs = deadline - now
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays < 0) {
    return 'overdue'
  }

  if (diffDays <= 3) {
    return 'due_soon'
  }

  if (diffDays <= 10) {
    return 'due_soon'
  }

  return 'on_track'
}

// Module type detection from business type
export function getModuleTypeFromBusinessType(businessType) {
  const typeMap = {
    pharmacy: ADR_MODULE_TYPES.COMMUNITY_PHARMACY,
    hospital: ADR_MODULE_TYPES.HOSPITAL,
    industry: ADR_MODULE_TYPES.INDUSTRY,
    skincare: ADR_MODULE_TYPES.SKINCARE,
  }
  return typeMap[businessType] || ADR_MODULE_TYPES.COMMUNITY_PHARMACY
}

// Status validation helpers
export function isValidStatus(status) {
  return Object.values(REPORT_STATUS).includes(status)
}

export function isDraftStatus(status) {
  return status === REPORT_STATUS.DRAFT
}

export function isSubmittedStatus(status) {
  return status === REPORT_STATUS.SUBMITTED
}