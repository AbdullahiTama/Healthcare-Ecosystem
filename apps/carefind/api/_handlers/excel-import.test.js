// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import writeExcelFile from 'write-excel-file/node'

// The business-directory Excel import: a signed-in user uploads an .xlsx, the server returns its rows. It used the xlsx package
// (unfixed prototype-pollution and ReDoS flaws on npm) and, because the browser uploads with FormData, parsed the multipart
// wrapper as text. These tests drive the handler with the exact body shapes a browser and a script send.
const h = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: h.getUser } }) }))

import handler from './excel-import.js'
import exportHandler from './excel-export.js'

const res = () => {
  const r = { statusCode: null, body: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}

const BOUNDARY = '----WebKitFormBoundaryAbC123'
const multipart = (file) => Buffer.concat([
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="b.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
  file,
  Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
])

// A request whose body arrives as a stream, like the real thing.
const request = (body, { token = 'tok', contentType } = {}) => {
  const req = Readable.from(body === undefined ? [] : [body])
  req.method = 'POST'
  req.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(contentType ? { 'content-type': contentType } : {}) }
  return req
}

const workbook = (rows) => writeExcelFile(rows.map((r) => r.map((value) => ({ value }))), { sheet: 'S' }).toBuffer()

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
  h.getUser.mockReset()
  h.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('excel-import: who may call it', () => {
  it('refuses anything but POST', async () => {
    const r = res()
    await handler({ method: 'GET', headers: {} }, r)
    expect(r.statusCode).toBe(405)
  })

  it('refuses a request with no token, and one whose session is invalid, without reading the body', async () => {
    let r = res()
    await handler(request(Buffer.from('x'), { token: '' }), r)
    expect(r.statusCode).toBe(401)

    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    r = res()
    await handler(request(Buffer.from('x')), r)
    expect(r.statusCode).toBe(401)
    expect(r.body).toEqual({ error: 'Invalid session' })
  })

  it('refuses to run when the server is not configured', async () => {
    vi.stubEnv('SUPABASE_URL', '')
    const r = res()
    await handler(request(Buffer.from('x')), r)
    expect(r.statusCode).toBe(500)
  })
})

describe('excel-import: parsing', () => {
  const sheet = [['Business Name ', ' STATE', 'Phone'], ['Ada Pharmacy', 'Lagos', '08012345678'], ['  Zed Clinic  ', 'Kano', null]]

  it('reads the workbook the BROWSER uploads (multipart/form-data): lower-cased trimmed headers, string records', async () => {
    const r = res()
    await handler(request(multipart(await workbook(sheet)), { contentType: `multipart/form-data; boundary=${BOUNDARY}` }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.headers).toEqual(['business name', 'state', 'phone'])
    expect(r.body.totalRows).toBe(2)
    expect(r.body.records).toEqual([
      { 'business name': 'Ada Pharmacy', state: 'Lagos', phone: '08012345678' },
      { 'business name': 'Zed Clinic', state: 'Kano', phone: '' },
    ])
  })

  it('also reads a raw .xlsx body (a script, or a platform that buffers the body)', async () => {
    const file = await workbook(sheet)
    let r = res()
    await handler(request(file, { contentType: 'application/octet-stream' }), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.totalRows).toBe(2)

    r = res()
    const buffered = { method: 'POST', headers: { authorization: 'Bearer tok' }, body: file }
    await handler(buffered, r)
    expect(r.statusCode).toBe(200)
    expect(r.body.totalRows).toBe(2)
  })

  it('does not return the multipart wrapper as data (the old behaviour: the boundary line came back as the header row)', async () => {
    const r = res()
    await handler(request(multipart(await workbook(sheet)), { contentType: `multipart/form-data; boundary=${BOUNDARY}` }), r)
    expect(JSON.stringify(r.body)).not.toContain('WebKitFormBoundary')
    expect(JSON.stringify(r.body)).not.toContain('Content-Disposition')
  })

  it('says a workbook with only a header row has no data', async () => {
    const r = res()
    await handler(request(await workbook([['name', 'state']])), r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/empty or has no data rows/)
  })

  it('turns blank header cells into empty names instead of the text "null"', async () => {
    const r = res()
    await handler(request(await workbook([['name', null, 'state'], ['A', 'x', 'Lagos']])), r)
    expect(r.body.headers).toEqual(['name', '', 'state'])
  })
})

describe('excel-import: input that is not a workbook is refused, not parsed', () => {
  it('refuses a legacy .xls with a message that says why', async () => {
    const xls = Buffer.from('d0cf11e0a1b11ae1' + '00'.repeat(600), 'hex')
    const r = res()
    await handler(request(xls), r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/legacy `?\.xls`? file/i)
  })

  it.each([
    ['plain text', Buffer.from('this is not a workbook')],
    ['an empty body', Buffer.alloc(0)],
    ['a CSV', Buffer.from('name,state\nAda,Lagos\n')],
  ])('refuses %s with a 400, never a 500', async (_label, body) => {
    const r = res()
    await handler(request(body), r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/Failed to parse Excel file|empty/)
  })

  it('refuses a multipart body that has no file part', async () => {
    const r = res()
    await handler(request(Buffer.from('nothing useful'), { contentType: `multipart/form-data; boundary=${BOUNDARY}` }), r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/uploaded file/)
  })
})

describe('export then import (the two handlers agree)', () => {
  it('re-imports exactly what was exported', async () => {
    const out = { headers: {}, statusCode: null, sent: null }
    out.setHeader = (k, v) => { out.headers[k] = v }
    out.status = (c) => { out.statusCode = c; return out }
    out.send = (b) => { out.sent = b; return out }
    out.json = (b) => { out.sent = b; return out }

    await exportHandler({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: {
        businesses: [{ name: 'Ada Pharmacy', category: { name: 'Pharmacy' }, state: 'Lagos', phone: '0801', latitude: 6.5244 }],
        fields: ['name', 'category', 'state', 'phone', 'latitude'],
      },
    }, out)
    expect(out.statusCode).toBe(200)

    const r = res()
    await handler(request(out.sent), r)
    expect(r.body.headers).toEqual(['business name', 'category', 'state', 'phone', 'latitude'])
    expect(r.body.records).toEqual([{ 'business name': 'Ada Pharmacy', category: 'Pharmacy', state: 'Lagos', phone: '0801', latitude: '6.5244' }])
  })
})
