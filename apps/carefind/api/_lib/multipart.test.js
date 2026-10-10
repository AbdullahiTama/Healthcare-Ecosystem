// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { extractUpload } from './multipart.js'

const BOUNDARY = '----WebKitFormBoundaryAbC123'
const wrap = (file, { boundary = BOUNDARY, name = 'file', filename = 'b.xlsx', type = 'application/octet-stream' } = {}) => Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
  file,
  Buffer.from(`\r\n--${boundary}--\r\n`),
])
const contentType = `multipart/form-data; boundary=${BOUNDARY}`

describe('extractUpload', () => {
  it('returns the file bytes out of the multipart wrapper the browser sends', () => {
    const file = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10])
    expect(extractUpload(wrap(file), contentType).equals(file)).toBe(true)
  })

  it('keeps file bytes that happen to contain CRLF, dashes and a partial boundary', () => {
    const file = Buffer.concat([Buffer.from('PK\r\n\r\n--\r\n----WebKit'), Buffer.from([0x00, 0x0d, 0x0a, 0x2d, 0x2d])])
    expect(extractUpload(wrap(file), contentType).equals(file)).toBe(true)
  })

  it('accepts a quoted boundary and extra parameters', () => {
    const file = Buffer.from('hello')
    const quoted = extractUpload(wrap(file, { boundary: 'b-1' }), 'multipart/form-data; charset=utf-8; boundary="b-1"')
    expect(quoted.toString()).toBe('hello')
  })

  it('treats a body that is not multipart as the file itself', () => {
    const file = Buffer.from('PK-raw')
    expect(extractUpload(file, 'application/octet-stream')).toBe(file)
    expect(extractUpload(file, undefined)).toBe(file)
  })

  it('returns null for a multipart body with no recognisable part, or a body that is not a Buffer', () => {
    expect(extractUpload(Buffer.from('no boundary in here'), contentType)).toBeNull()
    expect(extractUpload(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data`), contentType)).toBeNull()
    expect(extractUpload('a string', contentType)).toBeNull()
    expect(extractUpload(null, contentType)).toBeNull()
  })

  it('still returns the bytes when the closing boundary is missing (a truncated body)', () => {
    const body = Buffer.concat([Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"\r\n\r\n`), Buffer.from('partial')])
    expect(extractUpload(body, contentType).toString()).toBe('partial')
  })
})
