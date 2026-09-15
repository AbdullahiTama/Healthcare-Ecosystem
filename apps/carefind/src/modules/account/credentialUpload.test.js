import { describe, it, expect } from 'vitest'
import {
  validateCredentialFile, credentialStoragePath, describeUploadError,
  resolveContentType, MAX_CREDENTIAL_BYTES, ACCEPTED_CREDENTIAL_TYPES,
  CREDENTIAL_ACCEPT_ATTR,
} from './credentialUpload.js'

const file = (name, type, size = 1024) => ({ name, type, size })

describe('accepted types (issue #5: PDF licences)', () => {
  it('accepts PDF, the format many licences are issued in', () => {
    expect(ACCEPTED_CREDENTIAL_TYPES).toContain('application/pdf')
    expect(validateCredentialFile(file('licence.pdf', 'application/pdf')).ok).toBe(true)
  })

  it('advertises PDF on the file input, not just images', () => {
    expect(CREDENTIAL_ACCEPT_ATTR).toContain('application/pdf')
    expect(CREDENTIAL_ACCEPT_ATTR).toContain('.pdf')
  })

  it('still accepts the image formats it always did', () => {
    for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp']]) {
      expect(validateCredentialFile(file(name, type)).ok).toBe(true)
    }
  })

  it('accepts an iPhone HEIC even when the browser reports no type', () => {
    const result = validateCredentialFile(file('IMG_0042.HEIC', ''))
    expect(result.ok).toBe(true)
    expect(result.contentType).toBe('image/heic')
  })

  it('resolves an explicit content type so Storage never gets octet-stream', () => {
    expect(resolveContentType(file('scan.pdf', ''))).toBe('application/pdf')
    expect(resolveContentType(file('scan.pdf', 'application/pdf'))).toBe('application/pdf')
  })

  it('rejects an unsupported type by TYPE, not by size', () => {
    const result = validateCredentialFile(file('licence.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('type')
    expect(result.error).not.toMatch(/smaller|size|MB/i)
  })
})

describe('size limit', () => {
  it('accepts a file under 1MB — the case reported as failing', () => {
    expect(validateCredentialFile(file('licence.jpg', 'image/jpeg', 900 * 1024)).ok).toBe(true)
  })

  it('accepts a file just under the limit', () => {
    expect(validateCredentialFile(file('licence.jpg', 'image/jpeg', MAX_CREDENTIAL_BYTES - 1)).ok).toBe(true)
  })

  it('rejects a file over the limit and names the actual size', () => {
    const result = validateCredentialFile(file('licence.jpg', 'image/jpeg', 7 * 1024 * 1024))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('size')
    expect(result.error).toContain('7.0MB')
    expect(result.error).toContain('5MB')
  })

  it('reports a missing file as missing, not as a size problem', () => {
    const result = validateCredentialFile(null)
    expect(result.reason).toBe('missing')
  })
})

describe('storage path ownership', () => {
  // The new RLS policies check (storage.foldername(name))[1] = auth.uid(), so
  // the leading user folder is what makes the upload legal at all.
  it('puts the file in the uploading user own folder', () => {
    const path = credentialStoragePath('11111111-2222-3333-4444-555555555555', file('licence.pdf', 'application/pdf'), 1700000000000)
    expect(path).toBe('11111111-2222-3333-4444-555555555555/1700000000000.pdf')
    expect(path.split('/')[0]).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('falls back to a sensible extension when the filename has none', () => {
    expect(credentialStoragePath('u1', file('scan', 'application/pdf'), 5)).toBe('u1/5.pdf')
    expect(credentialStoragePath('u1', file('scan', 'image/png'), 5)).toBe('u1/5.jpg')
  })
})

describe('describeUploadError (issue #5: the message named the wrong cause)', () => {
  it('reports an RLS rejection as something other than a size problem', () => {
    const msg = describeUploadError({ statusCode: '403', message: 'new row violates row-level security policy' })
    expect(msg).not.toMatch(/smaller|larger/i)
  })

  it('reports a genuine oversize rejection as a size problem', () => {
    expect(describeUploadError({ statusCode: '413', message: 'The object exceeded the maximum allowed size' }))
      .toMatch(/5MB/)
  })

  it('reports a MIME rejection as a type problem', () => {
    expect(describeUploadError({ statusCode: '415', message: 'mime type text/plain is not supported' }))
      .toMatch(/file type is not supported/i)
  })

  it('surfaces the underlying message for anything unrecognised', () => {
    expect(describeUploadError({ message: 'network unreachable' })).toContain('network unreachable')
  })
})
