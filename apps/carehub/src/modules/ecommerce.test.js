import { describe, it, expect } from 'vitest'
import { createEcommerceRepository } from './ecommerce/repositories/index.js'
import { createInMemoryClient } from '../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'
const P1 = 'prod-1'
const P2 = 'prod-2'

const TERMS = [
  { id: 't-retail', segment: 'retail', version: 'v1', title: 'Retail Terms', content: 'Retail Terms full content with commission 10% at top. '.repeat(5), commission_rate: 0.10, commission_label: '10%', is_active: true },
  { id: 't-wholesale', segment: 'wholesale', version: 'v1', title: 'Wholesale Terms', content: 'Wholesale Terms full content 5% '.repeat(5), commission_rate: 0.05, commission_label: '5%', is_active: true },
  { id: 't-distributor', segment: 'distributor', version: 'v1', title: 'Distributor Terms', content: 'Distributor Terms full content 2.5% '.repeat(5), commission_rate: 0.025, commission_label: '2.5%', is_active: true },
]

function seeded() {
  const client = createInMemoryClient({
    ecommerce_terms: [...TERMS],
    products: [
      { id: P1, business_id: A, name: 'Paracetamol', price: 10, stock: 5, cat: 'medicine' },
      { id: P2, business_id: A, name: 'Bandage', price: 5, stock: 0, cat: 'device' },
      { id: 'p9', business_id: B, name: 'Other', price: 20, stock: 10 },
    ],
    ecommerce_applications: [
      { id: 'appA', business_id: A, status: 'Approved', terms_accepted: true, segment: 'retail', terms_version_id: 't-retail', accepted_commission_rate: 0.10 },
      { id: 'appB', business_id: B, status: 'Submitted', terms_accepted: true, segment: 'wholesale', terms_version_id: 't-wholesale', accepted_commission_rate: 0.05 },
    ],
    ecommerce_products: [
      { id: 'e1', business_id: A, product_id: P1, status: 'Active', description: 'Good drug for fever', category: 'medicine', ecommerce_price_kobo: 1000 },
      { id: 'e2', business_id: A, product_id: P2, status: 'Not Activated', description: null, category: null },
    ],
    ecommerce_product_images: [
      { id: 'img1', ecommerce_product_id: 'e1', url: 'https://example.com/a.jpg', position: 0 },
      { id: 'img2', ecommerce_product_id: 'e1', url: 'https://example.com/b.jpg', position: 1 },
    ],
  })
  const upload = async (bucket, path) => `https://storage/${bucket}/${path}`
  return { client, repo: createEcommerceRepository({ request: client, upload }) }
}

function recording(returns = []) {
  const calls = []
  const repo = createEcommerceRepository({
    request: async (path, options) => {
      calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null, prefer: options?.prefer })
      // simulate terms lookup for submitApplication when segment provided
      if (path.startsWith('ecommerce_terms')) {
        const seg = new URLSearchParams(path.split('?')[1] || '').get('segment')?.replace('eq.','')
        if (seg) return TERMS.filter(t => t.segment === seg && t.is_active)
        return TERMS
      }
      return returns
    },
    upload: async (bucket, path) => `https://storage/${bucket}/${path}`,
  })
  return { calls, repo }
}

describe('ecommerceRepository', () => {
  it('getApplication returns only calling tenant', async () => {
    const { repo } = seeded()
    const a = await repo.getApplication(A)
    expect(a.business_id).toBe(A)
    expect(a.status).toBe('Approved')
  })

  it('getTermsForSegment returns only requested segment with correct commission', async () => {
    const { repo } = seeded()
    const retail = await repo.getTermsForSegment('retail')
    expect(retail.segment).toBe('retail')
    expect(retail.commission_rate).toBe(0.10)
    expect(retail.content).toContain('10%')
    const wholesale = await repo.getTermsForSegment('wholesale')
    expect(wholesale.segment).toBe('wholesale')
    expect(wholesale.commission_rate).toBe(0.05)
    const distributor = await repo.getTermsForSegment('distributor')
    expect(distributor.segment).toBe('distributor')
    expect(distributor.commission_rate).toBe(0.025)
  })

  it('wholesale terms do not contain retail commission leakage', async () => {
    const { repo } = seeded()
    const wholesale = await repo.getTermsForSegment('wholesale')
    expect(wholesale.content).not.toContain('Retail Terms')
    const retail = await repo.getTermsForSegment('retail')
    expect(retail.content).not.toContain('Wholesale Terms')
  })

  it('full terms are displayed and readable (content not summary)', async () => {
    const { repo } = seeded()
    const t = await repo.getTermsForSegment('retail')
    expect(t.content.length).toBeGreaterThan(50)
    expect(t.title).toContain('Retail')
  })

  it('submitApplication requires terms', async () => {
    const { repo } = seeded()
    await expect(repo.submitApplication(A, { terms_accepted: false, seller_info: { contactName: 'Ada', contactPhone: '08012345678' } })).rejects.toThrow('terms')
  })

  it('submitApplication requires segment/terms_version', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' } })).rejects.toThrow('segment')
  })

  it('submitApplication stamps business_id and Approved with audit (auto-approve)', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS], ecommerce_applications: [] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: 'retail', terms_version_id: 't-retail', applicant_user_id: 'user-1', audit_metadata: { userAgent: 'test' } })
    const rows = client.rows('ecommerce_applications')
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ business_id: A, status: 'Approved', terms_accepted: true, segment: 'retail', terms_version_id: 't-retail', accepted_commission_rate: 0.10, applicant_user_id: 'user-1' })
    expect(rows[0].acceptance_timestamp).toBeTruthy()
    expect(rows[0].approval_timestamp).toBeTruthy()
    expect(rows[0].submitted_at).toBeTruthy()
  })

  it('successful retail Apply stores 10% rate', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: 'retail', terms_version_id: 't-retail' })
    const row = client.rows('ecommerce_applications')[0]
    expect(row.accepted_commission_rate).toBe(0.10)
  })
  it('successful wholesale Apply stores 5% rate', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo.submitApplication(B, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: 'wholesale', terms_version_id: 't-wholesale' })
    const row = client.rows('ecommerce_applications').find(r => r.business_id === B)
    expect(row.accepted_commission_rate).toBe(0.05)
  })
  it('successful distributor Apply stores 2.5% rate', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo.submitApplication('biz-C', { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: 'distributor', terms_version_id: 't-distributor' })
    const row = client.rows('ecommerce_applications')[0]
    expect(row.accepted_commission_rate).toBe(0.025)
  })

  it('Apply auto-resolves terms_version when only segment given', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: 'retail' })
    const row = client.rows('ecommerce_applications')[0]
    expect(row.terms_version_id).toBe('t-retail')
    expect(row.accepted_commission_rate).toBe(0.10)
  })

  it('Apply without explicit acceptance is blocked (Apply cannot be completed without required acceptance)', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.submitApplication(A, { terms_accepted: false, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: 'retail', terms_version_id: 't-retail' })).rejects.toThrow('terms')
    expect(client.rows('ecommerce_applications').length).toBe(0)
  })

  it('getInventoryWithStatus merges products with ecommerce status and respects stock', async () => {
    const { repo } = seeded()
    const rows = await repo.getInventoryWithStatus(A)
    const p1 = rows.find(r => r.product.id === P1)
    const p2 = rows.find(r => r.product.id === P2)
    expect(p1.status).toBe('Active')
    expect(p1.isActive).toBe(true)
    expect(p2.status).toBe('Out of Stock')
  })

  it('getInventoryWithStatus does not leak other tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getInventoryWithStatus(A)
    expect(rows.some(r => r.product.business_id === B)).toBe(false)
  })

  it('upsert validates price non-negative', async () => {
    const { repo } = seeded()
    await expect(repo.upsertEcommerceProduct(A, P1, { description: 'desc desc desc', category: 'medicine', ecommerce_price_kobo: -100 })).rejects.toThrow('Price must be')
  })

  it('upsert blocked when business not Approved (E_COMMERCE_NOT_APPROVED)', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appB', business_id: B, status: 'Submitted', terms_accepted: true }],
      products: [{ id: 'p9', business_id: B, name: 'Other', price: 20, stock: 10 }],
      ecommerce_products: [],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.upsertEcommerceProduct(B, 'p9', { description: 'Good desc here', category: 'medicine' })).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
  })

  it('upsert blocked for Not Applied business even via direct API (backend gate)', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [],
      products: [{ id: P1, business_id: A, name: 'X', stock: 5 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.upsertEcommerceProduct(A, P1, { description: 'Good description here', category: 'medicine' })).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
  })

  it('addImage blocked when not Approved', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appB', business_id: B, status: 'Submitted', terms_accepted: true }],
      ecommerce_products: [{ id: 'e9', business_id: B, product_id: 'p9', status: 'Not Activated', description: 'desc', category: 'medicine' }],
      ecommerce_product_images: [],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'https://storage/e.jpg' })
    await expect(repo.addImage('e9', { name: 'a.jpg', size: 1000, type: 'image/jpeg' }, 'image/jpeg')).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
  })

  it('Approved business immediately gains access to setup (upsert succeeds)', async () => {
    const { repo, client } = seeded()
    // A is Approved
    await repo.upsertEcommerceProduct(A, P1, { description: 'Updated good description here', category: 'medicine' })
    const updated = client.rows('ecommerce_products').find(r => r.product_id === P1)
    expect(updated.description).toBe('Updated good description here')
  })

  it('Approval does not automatically publish any product', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      products: [{ id: P1, business_id: A, name: 'X', stock: 5 }],
      ecommerce_applications: [],
      ecommerce_products: [],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: 'retail', terms_version_id: 't-retail' })
    expect(client.rows('ecommerce_products').length).toBe(0)
    const app = await repo.getApplication(A)
    expect(app.status).toBe('Approved')
  })

  it('activate blocked without Approved application', async () => {
    const { repo } = seeded()
    await expect(repo.activate(B, 'p9')).rejects.toThrow('Approved')
  })

  it('activate blocked without image', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      products: [{ id: P1, business_id: A, name: 'X', stock: 5 }],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.activate(A, P1)).rejects.toThrow('image')
  })

  it('activate blocked without description', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      products: [{ id: P1, business_id: A, name: 'X', stock: 5 }],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: null, category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.activate(A, P1)).rejects.toThrow('Description')
  })

  it('activate succeeds when complete', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }],
    })
    const repo2 = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo2.activate(A, P1)
    const updated = client.rows('ecommerce_products').find(r => r.id === 'e1')
    expect(updated.status).toBe('Active')
  })

  it('getImages ordered by position', async () => {
    const { repo } = seeded()
    const imgs = await repo.getImages('e1')
    expect(imgs.map(i => i.position)).toEqual([0, 1])
  })

  it('addImage validates file required', async () => {
    const { repo } = seeded()
    await expect(repo.addImage('e1', null, 'image/jpeg')).rejects.toThrow('File is required')
  })

  it('setStatus blocked when not Approved', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appB', business_id: B, status: 'Submitted', terms_accepted: true }],
      ecommerce_products: [{ id: 'e9', business_id: B, product_id: 'p9', status: 'Not Activated', description: 'desc', category: 'medicine', ecommerce_price_kobo: 100 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.setStatus(B, 'p9', 'Paused')).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
  })

  it('setStatus validates allowed values', async () => {
    const { repo } = seeded()
    await expect(repo.setStatus(A, P1, 'InvalidStatus')).rejects.toThrow('Invalid product status')
  })

  it('downstream commission matches accepted segment rate', async () => {
    const cases = [
      { seg: 'retail', id: 't-retail', rate: 0.10 },
      { seg: 'wholesale', id: 't-wholesale', rate: 0.05 },
      { seg: 'distributor', id: 't-distributor', rate: 0.025 },
    ]
    for (const c of cases) {
      const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
      const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
      await repo.submitApplication('biz-'+c.seg, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '08012345678' }, segment: c.seg, terms_version_id: c.id })
      const row = client.rows('ecommerce_applications').find(r => r.business_id === 'biz-'+c.seg)
      const orderTotal = 500000 // â‚¦5,000
      const expectedCommission = Math.round(orderTotal * c.rate)
      expect(row.accepted_commission_rate).toBe(c.rate)
      expect(Math.round(orderTotal * row.accepted_commission_rate)).toBe(expectedCommission)
    }
  })

  it('rejected/suspended business cannot perform setup', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appR', business_id: A, status: 'Rejected', terms_accepted: true }],
      products: [{ id: P1, business_id: A, name: 'X', stock: 5 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.upsertEcommerceProduct(A, P1, { description: 'Good description here', category: 'medicine' })).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
  })

  it('submit rejects mismatched segment vs terms_version', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'A', contactPhone: '080' }, segment: 'retail', terms_version_id: 't-wholesale' })).rejects.toThrow('does not match')
  })
  it('submit rejects inactive terms version', async () => {
    const inactive = [{ id: 't-old', segment: 'retail', version: 'v0', title: 'Old', content: 'old', commission_rate: 0.10, commission_label: '10%', is_active: false }]
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS, ...inactive] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'A', contactPhone: '080' }, segment: 'retail', terms_version_id: 't-old' })).rejects.toThrow('not active')
  })
  it('submit rejects unknown terms_version_id', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'A', contactPhone: '080' }, terms_version_id: 'nope' })).rejects.toThrow('not found')
  })
  it('submit resolves segment when only terms_version_id given', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'A', contactPhone: '080' }, terms_version_id: 't-distributor' })
    const row = client.rows('ecommerce_applications')[0]
    expect(row.segment).toBe('distributor')
    expect(row.accepted_commission_rate).toBe(0.025)
  })
  it('submit rejects whitespace contactName/phone', async () => {
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: '   ', contactPhone: '080' }, segment: 'retail', terms_version_id: 't-retail' })).rejects.toThrow('Contact name')
    await expect(repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'Ada', contactPhone: '   ' }, segment: 'retail', terms_version_id: 't-retail' })).rejects.toThrow('Contact name')
  })
  it('getTermsForSegment trims whitespace', async () => {
    const { repo } = seeded()
    const t = await repo.getTermsForSegment('  retail  ')
    expect(t.segment).toBe('retail')
  })
  it('addImage rejects empty file and unsupported format', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'desc', category: 'medicine' }],
      ecommerce_product_images: [],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.addImage('e1', { name: 'a.jpg', size: 0, type: 'image/jpeg' }, 'image/jpeg')).rejects.toThrow('empty')
    await expect(repo.addImage('e1', { name: 'a.svg', size: 1000, type: 'image/svg+xml' }, 'image/svg+xml')).rejects.toThrow('Unsupported')
  })
  it('reorderImages blocked when not Approved and validates ownership', async () => {
    const clientApproved = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'desc', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }, { id: 'img2', ecommerce_product_id: 'e1', url: 'b.jpg', position: 1 }],
    })
    const repoOk = createEcommerceRepository({ request: clientApproved, upload: async () => 'url' })
    await repoOk.reorderImages('e1', ['img2','img1'])
    const imgs = await repoOk.getImages('e1')
    expect(imgs.map(i => i.id)).toEqual(['img2','img1'])
    // not approved
    const clientBlocked = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appB', business_id: B, status: 'Submitted', terms_accepted: true }],
      ecommerce_products: [{ id: 'e9', business_id: B, product_id: 'p9', status: 'Not Activated', description: 'desc', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img9', ecommerce_product_id: 'e9', url: 'a.jpg', position: 0 }],
    })
    const repoBlocked = createEcommerceRepository({ request: clientBlocked, upload: async () => 'url' })
    await expect(repoBlocked.reorderImages('e9', ['img9'])).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
    // ownership invalid
    await expect(repoOk.reorderImages('e1', ['img9'])).rejects.toThrow('does not belong')
  })
  it('deleteImage and updateImagePositionAfterDelete blocked when not Approved', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appB', business_id: B, status: 'Submitted', terms_accepted: true }],
      ecommerce_products: [{ id: 'e9', business_id: B, product_id: 'p9', status: 'Not Activated', description: 'desc', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img9', ecommerce_product_id: 'e9', url: 'a.jpg', position: 0 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.deleteImage('img9')).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
    await expect(repo.updateImagePositionAfterDelete('e9')).rejects.toThrow('E_COMMERCE_NOT_APPROVED')
  })
  it('setStatus Active enforces completeness via activate', async () => {
    const client = createInMemoryClient({
      ecommerce_terms: [...TERMS],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'short', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.setStatus(A, P1, 'Active')).rejects.toThrow('Description')
  })
  it('terms commission_rate must match configured SEGMENT_RATES', async () => {
    const mismatched = [{ id: 't-bad', segment: 'retail', version: 'v2', title: 'Bad', content: 'bad', commission_rate: 0.20, commission_label: '20%', is_active: true }]
    const client = createInMemoryClient({ ecommerce_terms: [...TERMS, ...mismatched] })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'A', contactPhone: '080' }, segment: 'retail', terms_version_id: 't-bad' })).rejects.toThrow('mismatch')
  })
})

