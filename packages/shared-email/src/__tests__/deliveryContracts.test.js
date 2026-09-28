import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Static contracts, not behavioural tests. Each guards a defect that actually
// shipped. A behavioural test only fails in the one place a bug is reproduced;
// scanning the tree fails everywhere the pattern reappears, including in code
// nobody re-ran.

const REPO = fileURLToPath(new URL('../../../../', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.vercel', 'coverage', '.next', '.git'])
const SELF = 'packages/shared-email/src/__tests__/deliveryContracts.test.js'

function jsFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) jsFiles(join(dir, entry.name), acc)
    } else if (entry.isFile() && /\.(js|jsx)$/.test(entry.name)) {
      acc.push(join(dir, entry.name))
    }
  }
  return acc
}

const ALL = [...jsFiles(join(REPO, 'apps')), ...jsFiles(join(REPO, 'packages'))]
const rel = (p) => relative(REPO, p).split(sep).join('/')

// Tests are excluded from the source scans: they name tables and call methods
// in string literals purely to assert on them, and this file does the same.
const SOURCE = ALL.filter((f) => !rel(f).includes('__tests__') && rel(f) !== SELF)
const read = (f) => readFileSync(f, 'utf8')

// Return the single statement starting at `index`, bounded by the first
// semicolon at depth zero, or by a line break that is not a method chain. A
// fixed lookahead window is unsafe: a window wide enough to span a multi line
// insert also reaches into the next statement, so `from('email_outbox').update(...)`
// followed by `from('email_logs').insert(...)` read as an outbox insert and
// produced false failures on both Resend webhooks.
function statementAt(src, index) {
  let depth = 0
  for (let i = index; i < src.length; i++) {
    const ch = src[i]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (depth <= 0) {
      if (ch === ';') return src.slice(index, i)
      if (ch === '\n') {
        const next = src.slice(i + 1).match(/^[ \t]*(\S)/)
        if (!next || next[1] !== '.') return src.slice(index, i)
      }
    }
  }
  return src.slice(index)
}

const OUTBOX_WRITER = 'packages/shared-email/src/EmailService.js'

// Passing a subject at the call site means the catalog's subject_template and
// its brand rule are both bypassed. Today every producer does this, so not one
// email carries the required "CareHub:" / "CareFind:" prefix. These are the
// known offenders with a recorded reason; batch 3 moves them onto the catalog.
// The list may only shrink: a new offender, or a new entry, fails the test.
const KNOWN_SUBJECT_OFFENDERS = {
  'apps/carehub/api/_handlers/notify-registration.js': 'batch 3: move onto the catalog',
  'apps/carehub/api/_handlers/notify-business-status.js': 'batch 3: move onto the catalog',
  'apps/carehub/api/_handlers/verify-plan-payment.js': 'batch 3: move onto the catalog',
  'apps/carehub/api/_handlers/verify-appointment-payment.js': 'batch 3: move onto the catalog',
  'apps/carefind/api/_handlers/booking.js': 'batch 3: move onto the catalog',
  'apps/carefind/api/_handlers/verify-booking-payment.js': 'batch 3: move onto the catalog',
  'apps/carefind/api/_handlers/verify-shop-payment.js': 'batch 3: move onto the catalog',
  'apps/carefind/api/_handlers/verify-subscription-payment.js': 'batch 3: move onto the catalog',
  'apps/carefind/api/_handlers/paystack-webhook.js': 'batch 3: move onto the catalog',
}

// The services themselves, the auth path, and the operator preview tools.
// authEmail.js is exempt because enqueue_business_email_event rejects the auth
// category outright, so the auth templates can never take a catalog subject.
const SUBJECT_EXEMPT = new Set([
  'packages/shared-email/src/EmailService.js',
  'apps/carehub/src/lib/emailService.js',
  'apps/carefind/api/_lib/emailService.js',
  'packages/shared-email/src/authEmail.js',
  'apps/carehub/api/_handlers/email-send.js',
  'apps/carehub/api/_handlers/email-test-send.js',
  'apps/carefind/api/email/send.js',
  'apps/carefind/api/email/test-send.js',
])

describe('outbox write contract', () => {
  it('has no producer inserting into email_outbox outside the service', () => {
    const offenders = []
    for (const file of SOURCE) {
      const path = rel(file)
      if (path === OUTBOX_WRITER) continue
      const src = read(file)
      const re = /from\(\s*['"]email_outbox['"]\s*\)/g
      let m
      while ((m = re.exec(src)) !== null) {
        if (/\.\s*(insert|upsert)\s*\(/.test(statementAt(src, m.index))) {
          offenders.push(path)
          break
        }
      }
    }
    // check-subscription-expiry.js is the known offender. It omits app and
    // event_key, so every row it produced was parked as legacy_mapping_unproven
    // and silently never delivered. Batch 3 rewrites it onto the catalog.
    expect(offenders).toEqual(['apps/carefind/api/cron/check-subscription-expiry.js'])
  })

  it('still stamps app and event_key on every row the service writes', () => {
    // The quarantine trigger and the catalog both key on these two columns, so
    // the service is the one place that must always set them.
    const src = read(join(REPO, OUTBOX_WRITER))
    expect(src).toContain('app: app ||')
    expect(src).toContain('event_key: eventKey ||')
  })
})

describe('subject authority contract', () => {
  const offenders = SOURCE
    .filter((f) => /(?:enqueue|enqueueOutbox)\s*\(/.test(read(f)) && /subject\s*:/.test(read(f)))
    .map(rel)
    .filter((p) => !SUBJECT_EXEMPT.has(p))

  it('allows only the recorded offenders, so the list can only shrink', () => {
    expect(offenders.sort()).toEqual(Object.keys(KNOWN_SUBJECT_OFFENDERS).sort())
  })

  it('gives every offender a recorded reason naming the batch that removes it', () => {
    for (const [path, reason] of Object.entries(KNOWN_SUBJECT_OFFENDERS)) {
      expect(reason, `${path} needs a reason`).toBeTruthy()
      expect(reason, `${path} must name the batch that removes it`).toMatch(/batch \d/)
    }
  })
})

// U+FFFD is a replacement character: a byte sequence was decoded as the wrong
// encoding and the original glyph was destroyed. Here it replaced emoji and
// arrows. One of them sits in a subject string, which goes into a mail header,
// and several sit in in-app notification bodies, so customers see them too.
// This matches U+FFFD only, which is unambiguous, rather than guessing at
// mojibake byte pairs.
describe('encoding integrity contract', () => {
  it('confines replacement characters to the three known files, and only shrinks', () => {
    const found = []
    for (const file of SOURCE) {
      const count = (read(file).match(/\uFFFD/g) || []).length
      if (count) found.push(`${rel(file)} (${count})`)
    }
    expect(found.sort()).toEqual([
      'apps/carefind/api/_handlers/charge-subscription.js (2)',
      'apps/carefind/api/_handlers/paystack-webhook.js (15)',
      'apps/carefind/api/_handlers/verify-subscription-payment.js (2)',
    ])
  })
})
