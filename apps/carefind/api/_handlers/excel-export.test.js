// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readSheet } from 'read-excel-file/node'

// The business-directory Excel export (one sheet, "Businesses"). Replaced the xlsx package; the file the user downloads must stay
// the same shape: labelled header row, one row per business, numbers kept as numbers.
const h = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: h.getUser } }) }))

import handler from './excel-export.js'

const res = () => {
  const r = { statusCode: null, headers: {}, sent: null }
  r.setHeader = (k, v) => { r.headers[k] = v }
  r.status = (c) => { r.statusCode = c; return r }
  r.send = (b) => { r.sent = b; return r }
  r.json = (b) => { r.sent = b; return r }
  return r
}
const post = (body, token = 'tok') => ({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body })

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
  h.getUser.mockReset()
  h.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('excel-export: who may call it', () => {
  it('refuses anything but POST, a missing token, and an invalid session', async () => {
    let r = res()
    await handler({ method: 'GET', headers: {} }, r)
    expect(r.statusCode).toBe(405)

    r = res()
    await handler(post({ businesses: [] }, ''), r)
    expect(r.statusCode).toBe(401)

    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    r = res()
    await handler(post({ businesses: [] }), r)
    expect(r.statusCode).toBe(401)
  })

  it('requires a businesses array', async () => {
    for (const body of [undefined, {}, { businesses: 'nope' }]) {
      const r = res()
      await handler(post(body), r)
      expect(r.statusCode).toBe(400)
    }
  })
})

describe('excel-export: the file', () => {
  const businesses = [
    { name: 'Ada Pharmacy', category: { name: 'Pharmacy' }, subcategory: { name: 'Retail' }, address: '1 Allen Ave', state: 'Lagos', latitude: 6.5244, longitude: 3.3792, created_at: '2026-01-02T00:00:00Z' },
    { name: 'Zed Clinic', category: null, state: 'Kano', phone: '0803', latitude: 0 },
  ]

  it('returns an .xlsx with the right headers and a sheet that reads back', async () => {
    const r = res()
    await handler(post({ businesses, fields: ['name', 'category', 'subcategory', 'state', 'latitude', 'created_at'], filename: 'dir' }), r)
    expect(r.statusCode).toBe(200)
    expect(r.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(r.headers['Content-Disposition']).toBe('attachment; filename="dir.xlsx"')
    expect(Buffer.isBuffer(r.sent)).toBe(true)
    expect(r.sent.subarray(0, 2).toString('latin1')).toBe('PK')

    const rows = await readSheet(r.sent)
    expect(rows[0]).toEqual(['Business Name', 'Category', 'Subcategory', 'State', 'Latitude', 'Created At'])
    expect(rows[1].slice(0, 5)).toEqual(['Ada Pharmacy', 'Pharmacy', 'Retail', 'Lagos', 6.5244])
    expect(typeof rows[1][4]).toBe('number')
    expect(rows[1][5]).toBe(new Date('2026-01-02T00:00:00Z').toLocaleDateString())
    // a missing category and a zero coordinate become an empty cell, as before
    expect(rows[2][0]).toBe('Zed Clinic')
    expect(rows[2][1]).toBeNull()
    expect(rows[2][3]).toBe('Kano')
  })

  it('uses the default columns when none are asked for, and names the sheet "Businesses"', async () => {
    const r = res()
    await handler(post({ businesses }), r)
    const rows = await readSheet(r.sent)
    expect(rows[0]).toEqual(['Business Name', 'Category', 'Address', 'State', 'LGA', 'City', 'Phone', 'Email', 'Website', 'Verification Status', 'Latitude', 'Longitude'])
    expect(rows).toHaveLength(3)
    const { unzipSync } = await import('fflate')
    expect(Buffer.from(unzipSync(new Uint8Array(r.sent))['xl/workbook.xml']).toString()).toContain('name="Businesses"')
  })

  it('writes just the header row for an empty list, and unknown fields under their own name', async () => {
    const r = res()
    await handler(post({ businesses: [], fields: ['name', 'custom_field'] }), r)
    expect(r.statusCode).toBe(200)
    // a sheet with one row has no data rows, which readSheet returns as that single row
    expect(await readSheet(r.sent)).toEqual([['Business Name', 'custom_field']])
  })

  it('keeps hostile characters out of the Content-Disposition header', async () => {
    const r = res()
    await handler(post({ businesses: [], filename: 'a"b\r\nSet-Cookie: x=1' }), r)
    const header = r.headers['Content-Disposition']
    expect(header).not.toMatch(/[\r\n]/)
    expect(header).toMatch(/^attachment; filename="[\w.\- ]+\.xlsx"$/)
  })

  it('writes values that start like formulas as plain text, not formulas', async () => {
    const r = res()
    await handler(post({ businesses: [{ name: '=HYPERLINK("http://evil.example","click")' }], fields: ['name'] }), r)
    const { unzipSync } = await import('fflate')
    const files = unzipSync(new Uint8Array(r.sent))
    const sheetXml = Buffer.from(files['xl/worksheets/sheet1.xml']).toString()
    expect(sheetXml).not.toContain('<f>')
    expect((await readSheet(r.sent))[1][0]).toBe('=HYPERLINK("http://evil.example","click")')
  })
})
