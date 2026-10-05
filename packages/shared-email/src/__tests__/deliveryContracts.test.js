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
  // The withdrawal emails (settled / failed), each with a literal subject. They were written in withdrawalRecovery.js
  // and moved here unchanged by the phase 08 withdrawal engine, so this is the same offender under a new name.
  'apps/carefind/api/_lib/withdrawalEffects.js': 'batch 3: move onto the catalog',
  'apps/carefind/api/_handlers/booking.js': 'batch 3: move onto the catalog',
  // Added in batch 2. The original detection required a `subject:` literal, which
  // missed every producer that forwards a variable, and these four are the
  // dangerous ones: an authenticated caller supplies the subject. Two were
  // additionally hidden in SUBJECT_EXEMPT, which made the guard report full
  // coverage while checking neither of them.
  'apps/carehub/api/_handlers/email-send.js': 'batch 3: move onto the catalog; subject is caller controlled',
  'apps/carehub/api/_handlers/email-test-send.js': 'batch 3: operator preview tool, needs an explicit non catalog subject',
  'apps/carefind/api/email/send.js': 'batch 3: move onto the catalog; subject is caller controlled',
  'apps/carefind/api/email/test-send.js': 'batch 3: operator preview tool, needs an explicit non catalog subject',
  // Step 09/10 event wiring reused the same caller-subject pattern as the rest
  // of the rollout. Batch 3 centralizes subjects through the catalog instead.
  'apps/carefind/api/_handlers/cancel-appointment.js': 'batch 3: move onto the catalog',
  'apps/carefind/api/_handlers/initiate-withdrawal.js': 'batch 3: move onto the catalog',
  'apps/carehub/api/_handlers/initiate-business-withdrawal.js': 'batch 3: move onto the catalog',
  // Added 2026-10-04. The finance refactor moved the settlement confirmations out of six verify-* handlers (which
  // left this list) into one shared module. Its five literal subjects are the same ones those handlers carried, so
  // this is six offenders becoming one, not six being fixed.
  'packages/shared-payments/src/effects.js': 'batch 3: move onto the catalog',
}

// Files that build an email message and hand it to a callback the app wires to enqueue, so they never call enqueue
// themselves and the call-site pattern below cannot see them. Without this list, moving a producer behind a callback
// makes it vanish from the offender set while it still chooses its own subject.
const INDIRECT_PRODUCERS = new Set([
  'packages/shared-payments/src/effects.js',
])

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
  // A producer offends if it calls enqueue and supplies a subject at all, whether
  // as `subject: value` or as the `subject` shorthand. The original pattern
  // matched only the first form, so the four producers that forward a variable
  // were invisible to the guard: exactly the ones where the subject comes from
  // the request body.
  const SUBJECT_AT_CALL_SITE = /\bsubject\s*[:,}]/
  const offenders = SOURCE
    .filter((f) => INDIRECT_PRODUCERS.has(rel(f)) || /(?:enqueue|enqueueOutbox)\s*\(/.test(read(f)))
    .filter((f) => SUBJECT_AT_CALL_SITE.test(read(f)))
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

  it('detects a producer that forwards a subject variable, not just a literal', () => {
    // Guards the guard: if this pattern ever stops matching, the four caller
    // controlled producers above drop out of the offender set and the ratchet
    // silently reports full coverage again.
    expect(SUBJECT_AT_CALL_SITE.test("await emailService.enqueue({ a, subject })")).toBe(true)
    expect(SUBJECT_AT_CALL_SITE.test("await emailService.enqueue({ subject: x })")).toBe(true)
    expect(SUBJECT_AT_CALL_SITE.test("await emailService.enqueue({ toEmail })")).toBe(false)
  })

  it('still scans every indirect producer it names', () => {
    // A renamed or deleted file would silently drop out of the scan.
    const scanned = new Set(SOURCE.map(rel))
    for (const path of INDIRECT_PRODUCERS) expect(scanned.has(path), `${path} is not in the tree`).toBe(true)
  })
})

// U+FFFD is a replacement character: a byte sequence was decoded as the wrong
// encoding and the original glyph was destroyed. Here it replaced emoji and
// arrows. One of them sits in a subject string, which goes into a mail header,
// and several sit in in-app notification bodies, so customers see them too.
// This matches U+FFFD only, which is unambiguous, rather than guessing at
// mojibake byte pairs.
describe('encoding integrity contract', () => {
  it('finds no replacement character in any source file', () => {
    const found = []
    for (const file of SOURCE) {
      const count = (read(file).match(/\uFFFD/g) || []).length
      if (count) found.push(`${rel(file)} (${count})`)
    }
    expect(found.sort()).toEqual([])
  })
})
