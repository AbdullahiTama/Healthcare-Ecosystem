import { describe, it, expect } from 'vitest'
import { createAdrReportRepository, getModuleTypeFromBusinessType } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const BIZ_A = 'biz-A'
const BIZ_B = 'biz-B'
const REPORT_A = 'report-A'
const REPORT_B = 'report-B'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createAdrReportRepository({ request: client }) }
}

// The in-memory adapter does not speak rpc/ paths, so RPC call shapes are
// asserted with a recording adapter — each call's path, method and body are
// captured for the test to inspect.
function recordingRepo() {
  const calls = []
  const repo = createAdrReportRepository({
    request: async (path, options) => {
      calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
      return []
    },
  })
  return { calls, repo }
}

describe('adrReportRepository', () => {
  describe('report reads', () => {
    it('getReports returns only the calling tenant', async () => {
      const { repo } = build({
        adr_reports: [
          { report_id: REPORT_A, business_id: BIZ_A, report_number: 'ADR-2026-000001' },
          { report_id: REPORT_B, business_id: BIZ_B, report_number: 'ADR-2026-000002' },
        ],
      })
      const rows = await repo.getReports(BIZ_A)
      expect(rows.map(r => r.report_id)).toEqual([REPORT_A])
    })

    it('getReport returns a single row or null', async () => {
      const { repo } = build({
        adr_reports: [
          { report_id: REPORT_A, business_id: BIZ_A, report_number: 'ADR-2026-000001' },
        ],
      })
      expect((await repo.getReport(REPORT_A)).report_id).toBe(REPORT_A)
      expect(await repo.getReport('missing')).toBe(null)
    })

    it('getAnalytics queries the analytics view scoped to the business', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getAnalytics(BIZ_A)
      expect(calls).toEqual([
        { path: 'adr_report_analytics?business_id=eq.biz-A&select=*', method: 'GET', body: null },
      ])
    })

    it('getReportWithDetails assembles the aggregate in one pass', async () => {
      const { repo } = build({
        adr_reports: [{ report_id: REPORT_A, business_id: BIZ_A, status: 'draft' }],
        adr_report_products: [{ product_id: 'p1', report_id: REPORT_A, product_brand_name: 'Ampiclox' }],
        adr_report_concomitant_meds: [{ med_id: 'm1', report_id: REPORT_A, name: 'Metformin' }],
        adr_report_reactions: [{ reaction_id: 'r1', report_id: REPORT_A, reaction_description: 'Rash' }],
        adr_report_evidence_photos: [{ photo_id: 'ph1', report_id: REPORT_A, evidence_photo_file: 'https://x/y.jpg' }],
      })
      const full = await repo.getReportWithDetails(REPORT_A)
      expect(full.status).toBe('draft')
      expect(full.adr_products.map(p => p.product_id)).toEqual(['p1'])
      expect(full.adr_concomitant_meds.map(m => m.med_id)).toEqual(['m1'])
      expect(full.adr_reactions.map(r => r.reaction_id)).toEqual(['r1'])
      expect(full.adr_evidence_photos.map(p => p.photo_id)).toEqual(['ph1'])
      expect(await repo.getReportWithDetails('missing')).toBe(null)
    })
  })

  describe('report writes', () => {
    it('createReport stamps the tenant onto the new row', async () => {
      const { repo, client } = build()
      await repo.createReport(BIZ_A, { module_type: 'community_pharmacy', status: 'draft' })
      expect(client.rows('adr_reports')[0]).toMatchObject({
        module_type: 'community_pharmacy',
        status: 'draft',
        business_id: BIZ_A,
      })
    })

    // Phase 2 Item 4: per-user visibility relies on created_by_user_id being
    // written at creation — a reporter who skips it would create a row they can
    // never read back under the reporter-self RLS policy.
    it('createReport preserves the creating staff member', async () => {
      const { repo, client } = build()
      await repo.createReport(BIZ_A, { module_type: 'hospital', status: 'draft', created_by_user_id: 'staff-9' })
      expect(client.rows('adr_reports')[0].created_by_user_id).toBe('staff-9')
    })

    it('updateReport scopes by report_id only (RLS guards tenancy on the row)', async () => {
      const { repo, client } = build({
        adr_reports: [
          { report_id: REPORT_A, business_id: BIZ_A, patient_identifier: 'JS' },
        ],
      })
      await repo.updateReport(REPORT_A, { patient_identifier: 'J.S.' })
      expect(client.rows('adr_reports')[0].patient_identifier).toBe('J.S.')
    })

    it('submitReport posts to rpc/submit_adr_report with p_report_id', async () => {
      const { calls, repo } = recordingRepo()
      await repo.submitReport(REPORT_A)
      expect(calls).toEqual([
        { path: 'rpc/submit_adr_report', method: 'POST', body: { p_report_id: REPORT_A } },
      ])
    })
  })

  describe('child rows', () => {
    // Child tables have no business_id — tenancy is derived through the parent
    // report, so every child write must be scoped by its PK AND its report_id.
    it('addProduct stamps report_id onto the new row', async () => {
      const { repo, client } = build()
      await repo.addProduct(REPORT_A, { product_brand_name: 'Ampiclox' })
      expect(client.rows('adr_report_products')[0]).toMatchObject({
        product_brand_name: 'Ampiclox',
        report_id: REPORT_A,
      })
    })

    it('updateProduct and deleteProduct are scoped to the report', async () => {
      const { repo, client } = build({
        adr_report_products: [
          { product_id: 'p1', report_id: REPORT_A, product_brand_name: 'Ampiclox' },
          { product_id: 'p9', report_id: REPORT_B, product_brand_name: 'Other report' },
        ],
      })
      // p9 belongs to a different report — PATCH/DELETE scoped to REPORT_A must no-op.
      await repo.updateProduct('p9', REPORT_A, { product_brand_name: 'hacked' })
      await repo.deleteProduct('p9', REPORT_A)
      expect(client.rows('adr_report_products').map(p => p.product_id)).toEqual(['p1', 'p9'])

      await repo.updateProduct('p1', REPORT_A, { product_brand_name: 'Ampiclox 500' })
      expect(client.rows('adr_report_products')[0].product_brand_name).toBe('Ampiclox 500')

      await repo.deleteProduct('p1', REPORT_A)
      expect(client.rows('adr_report_products').map(p => p.product_id)).toEqual(['p9'])
    })

    it('addReaction, updateReaction, deleteReaction scope to the report', async () => {
      const { repo, client } = build({
        adr_report_reactions: [
          { reaction_id: 'r1', report_id: REPORT_A, reaction_description: 'Rash' },
          { reaction_id: 'r9', report_id: REPORT_B, reaction_description: 'Other' },
        ],
      })
      await repo.updateReaction('r9', REPORT_A, { severity: 'severe' })
      expect(client.rows('adr_report_reactions').find(r => r.reaction_id === 'r9').severity).toBe(undefined)

      await repo.updateReaction('r1', REPORT_A, { severity: 'severe' })
      expect(client.rows('adr_report_reactions').find(r => r.reaction_id === 'r1').severity).toBe('severe')

      await repo.deleteReaction('r1', REPORT_A)
      expect(client.rows('adr_report_reactions').map(r => r.reaction_id)).toEqual(['r9'])
    })

    it('concomitant meds and evidence photos scope to the report', async () => {
      const { repo, client } = build({
        adr_report_concomitant_meds: [
          { med_id: 'm1', report_id: REPORT_A, name: 'Metformin' },
          { med_id: 'm9', report_id: REPORT_B, name: 'Foreign' },
        ],
        adr_report_evidence_photos: [
          { photo_id: 'ph1', report_id: REPORT_A, evidence_photo_file: 'a' },
          { photo_id: 'ph9', report_id: REPORT_B, evidence_photo_file: 'b' },
        ],
      })
      await repo.deleteConcomitantMed('m9', REPORT_A)
      await repo.deleteEvidencePhoto('ph9', REPORT_A)
      expect(client.rows('adr_report_concomitant_meds').map(m => m.med_id)).toEqual(['m1', 'm9'])
      expect(client.rows('adr_report_evidence_photos').map(p => p.photo_id)).toEqual(['ph1', 'ph9'])

      await repo.deleteConcomitantMed('m1', REPORT_A)
      await repo.deleteEvidencePhoto('ph1', REPORT_A)
      expect(client.rows('adr_report_concomitant_meds').map(m => m.med_id)).toEqual(['m9'])
      expect(client.rows('adr_report_evidence_photos').map(p => p.photo_id)).toEqual(['ph9'])
    })

    it('createFollowUp creates a draft chained to the source report', async () => {
      const { repo, client } = build()
      await repo.createFollowUp({
        businessId: BIZ_A,
        moduleType: 'industry',
        followUpOfReportId: REPORT_A,
        createdByUserId: 'u1',
        followUpVersionNumber: 2,
      })
      expect(client.rows('adr_reports')[0]).toMatchObject({
        business_id: BIZ_A,
        module_type: 'industry',
        status: 'draft',
        follow_up_of_report_id: REPORT_A,
        created_by_user_id: 'u1',
        follow_up_version_number: 2,
      })
    })
  })

  describe('audit trail', () => {
    it('getReportEvents reads the report timeline oldest first', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getReportEvents(REPORT_A)
      expect(calls).toEqual([
        { path: `adr_report_events?report_id=eq.${REPORT_A}&order=created_at.asc&select=*`, method: 'GET', body: null },
      ])
    })

    it('logEvent posts to the adr_log_event RPC with report + event type + metadata', async () => {
      const { calls, repo } = recordingRepo()
      await repo.logEvent(REPORT_A, 'exported', { format: 'e2b' })
      expect(calls).toEqual([
        {
          path: 'rpc/adr_log_event',
          method: 'POST',
          body: { p_report_id: REPORT_A, p_event_type: 'exported', p_metadata: { format: 'e2b' } },
        },
      ])
    })
  })

  describe('uploads', () => {
    // The storage transport is a separate system from the PostgREST request
    // adapter, so uploads are asserted with a recording upload function.
    function uploadRepo() {
      const uploads = []
      const repo = createAdrReportRepository({
        request: async () => [],
        upload: async (bucket, path, file, mime, message) => {
          uploads.push({ bucket, path, mime, message, name: file.name })
          return `https://storage/${path}`
        },
      })
      return { uploads, repo }
    }

    it('uploadAttachment uploads under a custom prefix and returns the public URL', async () => {
      const { uploads, repo } = uploadRepo()
      const url = await repo.uploadAttachment({ name: 'lab.pdf' }, 'adr-hospital')
      expect(url).toMatch(/^https:\/\/storage\/adr-hospital\//)
      expect(uploads).toHaveLength(1)
      expect(uploads[0]).toMatchObject({ bucket: 'adr-evidence', mime: 'application/octet-stream', name: 'lab.pdf' })
      expect(uploads[0].path.startsWith('adr-hospital/')).toBe(true)
    })

    it('uploadEvidencePhoto reuses the generic upload under the adr-evidence prefix', async () => {
      const { uploads, repo } = uploadRepo()
      await repo.uploadEvidencePhoto({ name: 'photo.jpg', type: 'image/jpeg' })
      expect(uploads).toHaveLength(1)
      expect(uploads[0].path.startsWith('adr-evidence/')).toBe(true)
      expect(uploads[0].mime).toBe('image/jpeg')
    })
  })

  describe('getModuleTypeFromBusinessType', () => {
    it('maps enterprise business types to industry', () => {
      expect(getModuleTypeFromBusinessType('manufacturer_importer')).toBe('industry')
      expect(getModuleTypeFromBusinessType('wholesale')).toBe('industry')
      expect(getModuleTypeFromBusinessType('pharmacy')).toBe('community_pharmacy')
      expect(getModuleTypeFromBusinessType('hospital')).toBe('hospital')
      expect(getModuleTypeFromBusinessType('skincare')).toBe('skincare')
    })

    it('falls back to community_pharmacy for unknown business types', () => {
      expect(getModuleTypeFromBusinessType('unrecognized')).toBe('community_pharmacy')
    })
  })
})