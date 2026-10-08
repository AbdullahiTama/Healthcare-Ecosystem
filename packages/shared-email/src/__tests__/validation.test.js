import { describe, it, expect } from 'vitest'
import { validateMessage, isValidEmail, isValidFrom, validateSubject, validateHtml } from '../validation.js'

describe('validation', () => {
  it('accepts a well-formed message', () => {
    expect(validateMessage({
      from: 'CareHub <notifications@carehub.ng>',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      replyTo: 'support@carehub.ng',
    })).toBeNull()
  })

  it('rejects bad recipients, empty subject, empty html, script tags, header injection', () => {
    expect(validateMessage({ from: 'a@b.com', to: 'not-an-email', subject: 'x', html: '<p>x</p>' })).toMatch(/recipient/)
    expect(validateMessage({ from: 'a@b.com', to: 'a@b.com', subject: '\nBcc: x', html: '<p>x</p>' })).toMatch(/subject/)
    expect(validateMessage({ from: 'a@b.com', to: 'a@b.com', subject: 'x', html: '   ' })).toMatch(/html/)
    expect(validateMessage({ from: 'a@b.com', to: 'a@b.com', subject: 'x', html: '<script>alert(1)</script>' })).toMatch(/script/)
    expect(validateMessage({ from: 'Name <bad', to: 'a@b.com', subject: 'x', html: '<p>x</p>' })).toMatch(/from/)
    expect(validateMessage({ from: 'a@b.com', to: 'a@b.com', subject: 'x', html: '<p>x</p>', replyTo: 'bad' })).toMatch(/reply_to/)
  })

  it('email helpers', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('a@')).toBe(false)
    expect(isValidFrom('CareHub <notifications@carehub.ng>')).toBe(true)
    expect(isValidFrom('notifications@carehub.ng')).toBe(true)
    expect(validateSubject(' ok ')).toBeNull()
    expect(validateHtml('<p>ok</p>')).toBeNull()
  })
})
