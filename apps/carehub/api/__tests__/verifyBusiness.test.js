import { describe, it, expect } from 'vitest'
import { verifyBusiness, escapeLikePattern } from '../_lib/verifyBusiness.js'

// Audit F-09: the owner is matched with ILIKE on the auth email. `_` and `%` are pattern wildcards, so an
// unescaped `j_hn@provider.com` matched `john@provider.com`'s business. The pattern must only ever match the literal address.
const fake = (email, { business = { id: 'biz-1' } } = {}) => {
  const seen = { pattern: null, filters: [] }
  const q = {
    select: () => q,
    ilike: (col, pattern) => { seen.pattern = pattern; return q },
    is: (col, v) => { seen.filters.push([col, v]); return q },
    maybeSingle: async () => ({ data: business }),
  }
  return {
    seen,
    auth: { getUser: async (t) => (t === 'good' ? { data: { user: { id: 'u1', email, email_confirmed_at: '2026-01-01' } }, error: null } : { data: {}, error: { message: 'bad' } }) },
    from: () => q,
  }
}
const req = (token) => ({ headers: { authorization: token ? `Bearer ${token}` : '' } })

describe('escapeLikePattern', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLikePattern('j_hn@provider.com')).toBe('j\\_hn@provider.com')
    expect(escapeLikePattern('100%@x.com')).toBe('100\\%@x.com')
    expect(escapeLikePattern('a\\b@x.com')).toBe('a\\\\b@x.com')
    expect(escapeLikePattern('plain@x.com')).toBe('plain@x.com')
  })
})

describe('verifyBusiness', () => {
  it('queries with the escaped email so a wildcard in the login can match only itself', async () => {
    const s = fake('j_hn@provider.com')
    await verifyBusiness(s, req('good'))
    expect(s.seen.pattern).toBe('j\\_hn@provider.com')
    expect(s.seen.filters).toEqual([['parent_business_id', null]])
  })

  it('returns the business and the verified identity (needed for the per-person withdrawal PIN)', async () => {
    const out = await verifyBusiness(fake('o@x.com'), req('good'))
    expect(out.business).toEqual({ id: 'biz-1' })
    expect(out.user).toEqual({ id: 'u1', email: 'o@x.com', email_confirmed_at: '2026-01-01' })
  })

  it('refuses a missing or invalid token, and a login with no business', async () => {
    expect(await verifyBusiness(fake('o@x.com'), req(null))).toEqual({ error: 'not_logged_in' })
    expect(await verifyBusiness(fake('o@x.com'), req('bad'))).toEqual({ error: 'not_logged_in' })
    expect(await verifyBusiness(fake('o@x.com', { business: null }), req('good'))).toEqual({ error: 'no_business' })
  })
})
