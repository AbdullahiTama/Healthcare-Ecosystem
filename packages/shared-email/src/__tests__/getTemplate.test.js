import { describe, it, expect } from 'vitest'
import { getTemplate } from '../templates/index.js'

// getTemplate is the fail-closed lookup the outbox worker uses. It indexed a plain object, so a template_key that
// names something on Object.prototype ('constructor', 'toString', '__proto__') returned a function or object instead
// of null, and the worker then "rendered" it rather than failing the row.
describe('getTemplate', () => {
  it('returns a real template for each app', () => {
    expect(typeof getTemplate('password_reset', 'carefind')).toBe('function')
    expect(typeof getTemplate('password_reset', 'carehub')).toBe('function')
  })

  it('returns null for a key that only exists on Object.prototype', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(getTemplate(key, 'carefind'), key).toBeNull()
      expect(getTemplate(key, 'carehub'), key).toBeNull()
    }
  })

  it('returns null for an unknown key and for a non-string key', () => {
    expect(getTemplate('no_such_template', 'carefind')).toBeNull()
    expect(getTemplate(undefined, 'carefind')).toBeNull()
    expect(getTemplate(42, 'carehub')).toBeNull()
  })
})
