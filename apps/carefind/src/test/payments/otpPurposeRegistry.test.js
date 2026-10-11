// @vitest-environment node
// One-time-code purposes live in three places that cannot import each other: the SQL allowlist inside issue_otp, the
// OTP_PURPOSES constant in shared-payments, and the wording map in shared-email. A purpose missing from any of them
// fails only at runtime (a 500 on issue, or a generic sentence in the email). This test fails the build instead.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OTP_PURPOSE_VALUES } from '@care-ecosystem/shared-payments'
import { OTP_EMAIL_PURPOSES } from '@care-ecosystem/shared-email'

const dir = fileURLToPath(new URL('../../../../../supabase/migrations/', import.meta.url))

// The allowlist of the LAST migration (by file name, which sorts by date) that defines issue_otp.
function latestSqlAllowlist() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  let found = null
  for (const f of files) {
    const text = readFileSync(dir + f, 'utf8')
    if (!/create or replace function public\.issue_otp\(/.test(text)) continue
    const m = text.match(/p_purpose\s*=\s*any\s*\(\s*array\s*\[([^\]]+)\]/)
    if (m) found = { file: f, purposes: [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) }
  }
  return found
}

describe('one-time-code purposes', () => {
  it('the SQL allowlist, the JS registry and the email wording list exactly the same purposes', () => {
    const sql = latestSqlAllowlist()
    expect(sql, 'no migration defines issue_otp with an allowlist').not.toBeNull()
    expect([...sql.purposes].sort(), `allowlist in ${sql.file}`).toEqual([...OTP_PURPOSE_VALUES].sort())
    expect(Object.keys(OTP_EMAIL_PURPOSES).sort()).toEqual([...OTP_PURPOSE_VALUES].sort())
  })
})
