import { ADR_MODULE_TYPES, REPORT_STATUS } from './types'
import { adrReportRepository, getModuleTypeFromBusinessType } from './repositories'

// Data access lives in ./repositories — these named exports keep the older
// callers (AdrReportsList, Reports) working without changing their import path.
// The repository is the single source of truth for query shape and tenant
// scoping; this module only re-exports it and holds the pure helpers below.
export const createAdrReport = (reportData) => {
  // Back-compat: the previous signature took reportData WITH business_id baked
  // in. The repository stamps business_id itself, so pull it out here.
  const { business_id, ...rest } = reportData || {}
  return adrReportRepository.createReport(business_id, rest)
}

export const getAdrReports = (businessId, filters = {}) =>
  adrReportRepository.getReports(businessId, filters)

export const getAdrReport = async (reportId) => adrReportRepository.getReport(reportId)

export const updateAdrReport = (reportId, data) =>
  adrReportRepository.updateReport(reportId, data)

export const submitAdrReport = (reportId) => adrReportRepository.submitReport(reportId)

export const createAdrProduct = (productData) => {
  const { report_id, ...rest } = productData || {}
  return adrReportRepository.addProduct(report_id, rest)
}

export const getAdrProducts = (reportId) => adrReportRepository.getProducts(reportId)

export const updateAdrProduct = (productId, data) => {
  const { report_id, ...rest } = data || {}
  return adrReportRepository.updateProduct(productId, report_id, rest)
}

export const deleteAdrProduct = (productId, reportId) =>
  adrReportRepository.deleteProduct(productId, reportId)

export const createAdrConcomitantMeds = (medsData) => {
  const { report_id, ...rest } = medsData || {}
  return adrReportRepository.addConcomitantMed(report_id, rest)
}

export const getAdrConcomitantMeds = (reportId) =>
  adrReportRepository.getConcomitantMeds(reportId)

export const createAdrReaction = (reactionData) => {
  const { report_id, ...rest } = reactionData || {}
  return adrReportRepository.addReaction(report_id, rest)
}

export const getAdrReactions = (reportId) => adrReportRepository.getReactions(reportId)

export const updateAdrReaction = (reactionId, data) => {
  const { report_id, ...rest } = data || {}
  return adrReportRepository.updateReaction(reactionId, report_id, rest)
}

export const uploadAdrPhoto = (bucket, path, file, contentType) =>
  adrReportRepository.uploadEvidencePhoto(file)

export const createAdrEvidencePhoto = (photoData) => {
  const { report_id, ...rest } = photoData || {}
  return adrReportRepository.addEvidencePhoto(report_id, rest)
}

export const getAdrEvidencePhotos = (reportId) =>
  adrReportRepository.getEvidencePhotos(reportId)

// ── Deadline calculation (pure) ───────────────────────────────────────────────
// Section 6 rule table. `reactionExpected` is the report row's boolean
// `reaction_expected`; `newSafetySignal` is the industry `new_safety_signal`.
export function calculateDeadline(reportCreatedAt, isSerious, reactionExpected, newSafetySignal) {
  const from = new Date(reportCreatedAt).getTime()
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  if (newSafetySignal) return new Date(from + 3 * DAY) // industry safety signal: +3 days
  if (isSerious && !reactionExpected) return new Date(from + 72 * HOUR) // serious + unexpected: 72h
  if (isSerious && reactionExpected) return new Date(from + 15 * DAY) // serious + expected: 15 days
  if (!isSerious && !reactionExpected) return new Date(from + 15 * DAY) // non-serious + unexpected: 15 days
  return new Date(from + 90 * DAY) // non-serious + expected: 90 days
}

// Read-computed status: on_track / due_soon / overdue.
// Uses the percentage of the reporting window remaining (Section 4.3 industry
// thresholds applied uniformly): green > 50% remaining, amber 20–50%, red
// < 20% or overdue.
export function getDeadlineStatus(deadline, createdAt) {
  const now = new Date().getTime()
  const deadlineMs = new Date(deadline).getTime()
  const createdMs = new Date(createdAt).getTime()

  if (deadlineMs - now <= 0) return 'overdue'

  const windowMs = deadlineMs - createdMs
  if (windowMs <= 0) return 'overdue'

  const remaining = (deadlineMs - now) / windowMs
  if (remaining < 0.2) return 'overdue'
  if (remaining < 0.5) return 'due_soon'
  return 'on_track'
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

export { getModuleTypeFromBusinessType }
export { ADR_MODULE_TYPES }