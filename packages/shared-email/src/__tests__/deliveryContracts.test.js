import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTemplate, getSubject } from '../templates/index.js'

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
  // Added in batch 2. The original detection required a `subject:` literal, which
  // missed every producer that forwards a variable, and these four are the
  // dangerous ones: an authenticated caller supplies the subject. Two were
  // additionally hidden in SUBJECT_EXEMPT, which made the guard report full
  // coverage while checking neither of them.
  // apps/carehub/api/_handlers/email-send.js and apps/carefind/api/email/send.js
  // were removed from this list: both used to forward req.body.subject straight
  // into enqueue, letting any authenticated caller set the subject line of a
  // branded email. They no longer read a subject at all, and the worker resolves
  // it from the key's canonical subject. The two operator preview tools stay:
  // their subject is the [TEST] marker, not caller text.
  'apps/carehub/api/_handlers/email-test-send.js': 'operator preview tool; subject is the [TEST] marker, not caller text',
  'apps/carefind/api/email/test-send.js': 'operator preview tool; subject is the [TEST] marker, not caller text',
}

// The services themselves and the auth path. authEmail.js is exempt because
// enqueue_business_email_event rejects the auth category outright, so the auth
// templates can never take a catalog subject. The four files that used to be
// exempted here are now tracked offenders, because exempting them is what let
// the audit conclude 9 producers when there are 13.
const SUBJECT_EXEMPT = new Set([
  'packages/shared-email/src/EmailService.js',
  'apps/carehub/src/lib/emailService.js',
  'apps/carefind/api/_lib/emailService.js',
  'packages/shared-email/src/authEmail.js',
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
    // check-subscription-expiry.js used to be the only raw writer. It omitted
    // app and event_key, so guard_email_outbox_quarantine() parked every row it
    // produced as legacy_mapping_unproven with next_retry_at='infinity': the
    // cron reported enqueued counts and delivered nothing. It now goes through
    // the shared service, so no file may write email_outbox directly again.
    expect(offenders).toEqual([])
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
  // A producer offends if it calls enqueue and supplies a subject at all, whether
  // as `subject: value` or as the `subject` shorthand. The original pattern
  // matched only the first form, so the four producers that forward a variable
  // were invisible to the guard: exactly the ones where the subject comes from
  // the request body.
  const SUBJECT_AT_CALL_SITE = /\bsubject\s*[:,}]/
  const offenders = SOURCE
    .filter((f) => /(?:enqueue|enqueueOutbox)\s*\(/.test(read(f)))
    .filter((f) => SUBJECT_AT_CALL_SITE.test(read(f)))
    .map(rel)
    .filter((p) => !SUBJECT_EXEMPT.has(p))

  it('allows only the recorded offenders, so the list can only shrink', () => {
    expect(offenders.sort()).toEqual(Object.keys(KNOWN_SUBJECT_OFFENDERS).sort())
  })

  it('gives every offender a recorded reason', () => {
    // The reasons no longer all name a batch: the two operator preview tools are
    // not going away in batch 3, they need a subject the catalog cannot supply.
    // The ratchet that matters is the test above, which fails if the offender
    // list ever grows.
    for (const [path, reason] of Object.entries(KNOWN_SUBJECT_OFFENDERS)) {
      expect(reason, `${path} needs a reason`).toBeTruthy()
    }
  })

  it('detects a producer that forwards a subject variable, not just a literal', () => {
    // Guards the guard: if this pattern ever stops matching, the four caller
    // controlled producers above drop out of the offender set and the ratchet
    // silently reports full coverage again.
    expect(SUBJECT_AT_CALL_SITE.test("await emailService.enqueue({ a, subject })")).toBe(true)
    expect(SUBJECT_AT_CALL_SITE.test("await emailService.enqueue({ subject: x })")).toBe(true)
    expect(SUBJECT_AT_CALL_SITE.test("await emailService.enqueue({ toEmail })")).toBe(false)
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

describe('send endpoint allowlist contract', () => {
  // The referral panel's only two live email calls returned 400 because
  // agent_approved and agent_rejected were missing from the CareHub allowlist.
  // Nothing failed loudly: the panel swallowed the error and the agent was never
  // told. A key that no renderer can satisfy fails the same silent way, so both
  // halves of the pair are asserted against the real registry.
  const HANDLERS = [
    { path: 'apps/carehub/api/_handlers/email-send.js', app: 'carehub' },
    { path: 'apps/carefind/api/email/send.js', app: 'carefind' },
  ]

  const allowlistOf = (src) => {
    const m = src.match(/const allowedTemplates = \[([\s\S]*?)\]/)
    if (!m) return null
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }

  for (const { path, app } of HANDLERS) {
    it(`${app}: every allowlisted key resolves to a real renderer`, () => {
      const list = allowlistOf(read(join(REPO, path)))
      expect(list, `${path} must declare an allowlist`).toBeTruthy()
      for (const key of list) {
        expect(getTemplate(key, app), `${path} allowlists ${key} but ${app} has no renderer`).toBeTypeOf('function')
        expect(getSubject(key, app, {}), `${path} allowlists ${key} but ${app} has no subject`).not.toBe('')
      }
    })
  }

  it('carehub allowlists the two keys the referral panel calls', () => {
    const list = allowlistOf(read(join(REPO, 'apps/carehub/api/_handlers/email-send.js')))
    expect(list).toContain('agent_approved')
    expect(list).toContain('agent_rejected')
  })

  it('no send endpoint reads a subject out of the request body', () => {
    // The subject is resolved by the worker from the template registry. Forwarding
    // req.body.subject let any authenticated caller set the subject line of a
    // branded email.
    for (const { path } of HANDLERS) {
      const src = read(join(REPO, path))
      const destructure = src.match(/const \{([^}]*)\} = req\.body/)
      expect(destructure, `${path} must destructure req.body`).toBeTruthy()
      expect(destructure[1], `${path} must not destructure subject`).not.toMatch(/\bsubject\b/)
    }
  })
})
