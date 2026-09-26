import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EmailService, getEmailService } from '../EmailService.js'

// Minimal chainable stub: processBatch() only needs the pending/failed query
// to resolve empty, so no row ever reaches sendEmail and Resend is untouched.
function emptyOutboxDb() {
  const table = {
    select: () => table,
    in: () => table,
    lte: () => table,
    order: () => table,
    limit: async () => ({ data: [], error: null }),
  }
  return { from: () => table }
}

describe('EmailService dependency loading', () => {
  it('processBatch works with an injected client and never loads supabase-js', async () => {
    const service = new EmailService({ supabase: emptyOutboxDb() })
    const result = await service.processBatch()
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 })
  })

  it('getEmailService forwards options so the first caller can inject a client', () => {
    const db = emptyOutboxDb()
    expect(getEmailService({ supabase: db })._db).toBe(db)
  })

  // The production failure was a runtime "Cannot find package
  // '@supabase/supabase-js'": a bare specifier only resolves by walking up from
  // packages/shared-email/, and Vercel deploys that package without its own
  // node_modules. deps() runs on every processBatch(), so the import had to
  // move out of it, not just be lazy. Asserted on the source because a
  // behavioural test only fails where resolution happens to be broken.
  it('keeps the supabase-js specifier out of deps()', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../EmailService.js', import.meta.url)),
      'utf8'
    )
    // Slice to the closing brace of deps() only. Cutting at loadCreateClient()
    // would sweep in the comment above it, which quotes the specifier.
    const start = source.indexOf('async function deps()')
    const depsBody = source.slice(start, source.indexOf('\n}', start) + 2)
    expect(depsBody).not.toContain('@supabase/supabase-js')
    expect(source).toContain("import('@supabase/supabase-js')")
  })
})
