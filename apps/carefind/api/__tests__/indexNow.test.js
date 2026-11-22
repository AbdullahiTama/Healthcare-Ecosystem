// @vitest-environment node
// Daily IndexNow submission (api/_lib/indexNow.js): what is sent, where, when it is skipped, and that only public
// pages are ever included.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { INDEXNOW_KEY, INDEXNOW_ENDPOINT, changedPaths, submitUrls, submitChangedPages } from '../_lib/indexNow.js'

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const HIDDEN = 'a0000000-0000-4000-8000-000000000002'
const PRO = '10000000-0000-4000-8000-000000000001'
const NEWS = 'd0000000-0000-4000-8000-000000000001'
const POST = 'e0000000-0000-4000-8000-000000000001'

// Fake PostgREST: rows per table; records each request's table and params.
let tables, requests
function fakeFetch(url, init) {
  const u = new URL(url)
  if (u.href.startsWith(INDEXNOW_ENDPOINT)) throw new Error('unexpected IndexNow call')
  const table = u.pathname.split('/').pop()
  requests.push({ table, params: Object.fromEntries(u.searchParams), range: init?.headers?.Range })
  const from = Number((init?.headers?.Range || '0-').split('-')[0])
  const data = from === 0 ? (tables[table] || []) : []
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://db.example'
  process.env.SUPABASE_ANON_KEY = 'anon-key'
  requests = []
  tables = {
    businesses: [{ id: BIZ, name: 'Ada Pharmacy', city: 'Ikeja', state: 'Lagos' }],
    profiles: [{ id: PRO, full_name: 'Ngozi Okafor', specialty: 'Pharmacist', is_verified: true }],
    news: [{ id: NEWS, headline: 'Malaria vaccine rollout begins in Lagos' }],
    posts: [{ id: POST, content: JSON.stringify([{ type: 'heading', content: '**Why you should finish your antibiotics course**' }, { type: 'text', content: 'Body' }]) }],
    carefind_products: [
      { name: 'Amoxil 500mg', generic_name: 'Amoxicillin', stock: 4, business_id: BIZ, businesses: { id: BIZ, status: 'active', visible_on_carefind: true } },
      { name: 'Coartem', generic_name: null, stock: 0, business_id: BIZ, businesses: { id: BIZ, status: 'active', visible_on_carefind: true } },
      { name: 'Secret Tonic', generic_name: null, stock: 9, business_id: HIDDEN, businesses: { id: HIDDEN, status: 'suspended', visible_on_carefind: true } },
      { name: 'Embargoed', generic_name: null, stock: 9, business_id: HIDDEN, businesses: null },
    ],
  }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY })

describe('changedPaths', () => {
  it('asks only for public rows changed since the given time', async () => {
    await changedPaths('2026-11-21T00:00:00.000Z')
    const by = Object.fromEntries(requests.map((r) => [r.table, r.params]))
    expect(by.businesses).toMatchObject({ status: 'eq.active', visible_on_carefind: 'eq.true', updated_at: 'gte.2026-11-21T00:00:00.000Z' })
    expect(by.profiles).toMatchObject({ is_verified: 'eq.true', updated_at: 'gte.2026-11-21T00:00:00.000Z' })
    expect(by.news).toMatchObject({ status: 'eq.approved', updated_at: 'gte.2026-11-21T00:00:00.000Z' })
    expect(by.posts).toMatchObject({ post_type: 'eq.article', repost_of: 'is.null' })
    expect(by.posts.or).toContain('updated_at.gte.2026-11-21T00:00:00.000Z')
    expect(by.posts.and).toContain('subscriber_only.eq.false')
    expect(by.posts.and).toContain('is_premium.eq.false')
    expect(by.carefind_products).toMatchObject({ updated_at: 'gte.2026-11-21T00:00:00.000Z' })
    // Reads as a logged-out visitor.
    expect(fetch.mock.calls.every(([, init]) => init.headers.apikey === 'anon-key')).toBe(true)
  })

  it('builds the same slug URLs the site serves; medicines by brand and generic name', async () => {
    const paths = await changedPaths('2026-11-21T00:00:00.000Z')
    expect(paths).toEqual(expect.arrayContaining([
      `/business/ada-pharmacy-ikeja-lagos-${BIZ}`,
      `/u/ngozi-okafor-pharmacist-${PRO}`,
      expect.stringMatching(new RegExp(`^/news/malaria-vaccine-rollout.*-${NEWS}$`)),
      expect.stringMatching(new RegExp(`^/post/why-you-should-finish.*-${POST}$`)),
      '/drug/amoxil%20500mg', '/drug/amoxicillin',
    ]))
  })

  it('includes a medicine that just went out of stock (its page now says not listed)', async () => {
    expect(await changedPaths('2026-11-21T00:00:00.000Z')).toContain('/drug/coartem')
  })

  it('never includes listings of a hidden or suspended seller, or unverified profiles', async () => {
    tables.profiles.push({ id: '10000000-0000-4000-8000-000000000002', full_name: 'Not Verified', is_verified: false })
    const paths = await changedPaths('2026-11-21T00:00:00.000Z')
    expect(paths.join(' ')).not.toMatch(/secret|embargoed|not-verified/)
  })

  it('a failed read leaves that kind out instead of failing the run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetch.mockImplementation((url, init) => (new URL(url).pathname.endsWith('/news') ? Promise.resolve(new Response('boom', { status: 500 })) : fakeFetch(url, init)))
    const paths = await changedPaths('2026-11-21T00:00:00.000Z')
    expect(paths.some((p) => p.startsWith('/news/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/business/'))).toBe(true)
    console.error.mockRestore()
  })
})

describe('submitUrls', () => {
  it('posts host, key, key location and URLs to IndexNow', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 202 }))
    const sent = await submitUrls(['https://carefind.app/drug/amoxicillin'], { siteUrl: 'https://carefind.app', fetchImpl })
    expect(sent).toBe(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(INDEXNOW_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      host: 'carefind.app', key: INDEXNOW_KEY, keyLocation: `https://carefind.app/${INDEXNOW_KEY}.txt`,
      urlList: ['https://carefind.app/drug/amoxicillin'],
    })
  })

  it('sends in batches of 10,000', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }))
    const urls = Array.from({ length: 10001 }, (_, i) => `https://carefind.app/drug/m${i}`)
    expect(await submitUrls(urls, { siteUrl: 'https://carefind.app', fetchImpl })).toBe(10001)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).urlList).toEqual(['https://carefind.app/drug/m10000'])
  })

  it('a refusal is reported as an error (the next day resends)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }))
    await expect(submitUrls(['https://carefind.app/'], { siteUrl: 'https://carefind.app', fetchImpl })).rejects.toThrow('HTTP 403')
  })
})

describe('submitChangedPages', () => {
  it('does nothing outside production, or when disabled', async () => {
    expect(await submitChangedPages({ env: { VERCEL_ENV: 'preview' } })).toEqual({ skipped: 'not production' })
    expect(await submitChangedPages({ env: { VERCEL_ENV: 'production', INDEXNOW_DISABLED: 'true' } })).toEqual({ skipped: 'disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('looks back 26 hours and submits each changed page once, on the configured domain', async () => {
    const calls = []
    fetch.mockImplementation((url, init) => {
      if (url === INDEXNOW_ENDPOINT) { calls.push(JSON.parse(init.body)); return Promise.resolve(new Response('', { status: 202 })) }
      return fakeFetch(url, init)
    })
    tables.carefind_products.push({ ...tables.carefind_products[0] }) // same medicine changed at two sellers
    const now = Date.parse('2026-11-22T03:00:00Z')
    const out = await submitChangedPages({ env: { VERCEL_ENV: 'production', SITE_URL: 'https://carefind.app' }, now })
    expect(requests.find((r) => r.table === 'businesses').params.updated_at).toBe('gte.2026-11-21T01:00:00.000Z')
    const urls = calls[0].urlList
    expect(urls.every((u) => u.startsWith('https://carefind.app/'))).toBe(true)
    expect(new Set(urls).size).toBe(urls.length)
    expect(out.sent).toBe(urls.length)
  })

  it('sends nothing when nothing changed', async () => {
    tables = {}
    expect(await submitChangedPages({ env: { VERCEL_ENV: 'production' } })).toEqual({ sent: 0 })
    expect(fetch.mock.calls.some(([u]) => u === INDEXNOW_ENDPOINT)).toBe(false)
  })
})
