// Guards the Vercel Hobby cron contract for every vercel.json in the repo.
//
// Vercel enforces two Hobby limits at build time, not at runtime:
//   1. A deployment may declare at most two cron jobs.
//   2. A cron job may fire at most once per day, so its minute and hour fields
//      must each resolve to a single value.
// Breaching either fails the build, which is how a `*/5 * * * *` outbox drain
// took every CareFind deploy down while DEPLOYMENT.md still documented a daily
// schedule. The guard did not exist when that drift was introduced, so it cannot
// explain it; it is here to make the same edit expensive to repeat.
//
// This file lives in src/ rather than api/ on purpose: every non-underscore .js
// under api/ sits on Vercel's serverless function surface, and the 12-function
// Hobby cap is load-bearing for this app (see api/router.js). A test file is not
// a function and must not spend one of the twelve slots.
//
// It is deliberately repository-wide. apps/carehub/vercel.json obeys the same
// limits, and any new app must too. That claim is only true in CI if the
// workflow that runs this file is triggered by a change to those other configs —
// see the `paths` filters in .github/workflows/carefind-ci.yml.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOBBY_MAX_CRONS = 2

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))

function findRepoRoot(fromDir) {
  let dir = fromDir
  for (;;) {
    if (existsSync(path.join(dir, 'apps')) && existsSync(path.join(dir, 'packages'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not locate the repository root above ${fromDir}`)
    }
    dir = parent
  }
}

const REPO_ROOT = findRepoRoot(TEST_DIR)

// node_modules mirrors the app tree and dist/.vercel hold build output. Neither
// is a deployable configuration, and walking them costs seconds per run.
const PRUNED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage'])

function findVercelConfigs(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // An unreadable directory (EACCES, or EBUSY on Windows while another
    // process holds it) must not abort the whole walk, or every config beneath
    // it would go silently unvalidated.
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || PRUNED_DIRECTORIES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      findVercelConfigs(full, found)
    } else if (entry.name === 'vercel.json') {
      found.push(full)
    }
  }
  return found
}

// A config that is not valid JSON is itself a finding, not a reason to abort the
// run before a single assertion executes. Each entry therefore carries either a
// config or a parse error for the guard to report by name.
const CONFIGS = findVercelConfigs(REPO_ROOT)
  .sort()
  .map((file) => {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/')
    try {
      return { file: relative, config: JSON.parse(readFileSync(file, 'utf8')) }
    } catch (error) {
      return { file: relative, parseError: error.message }
    }
  })

const CAREFIND = CONFIGS.find(({ file }) => file === 'apps/carefind/vercel.json')

// A cron field is `*`, `n`, `a-b`, or either form followed by `/step`, and a
// field may be a comma separated list of those. Returns every value the field
// matches, or null when it is not a legal expression.
function expandField(field, min, max) {
  const values = new Set()

  for (const part of field.split(',')) {
    const segments = part.split('/')
    if (segments.length > 2) return null

    const [range, stepText] = segments
    // Number() would accept '0x5' and '1e1' as 5 and 1, so a step is also
    // restricted to a plain decimal.
    if (stepText !== undefined && !/^\s*\d+\s*$/.test(stepText)) return null
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) return null

    let start
    let end
    if (range === '*') {
      start = min
      end = max
    } else if (range.includes('-')) {
      const bounds = range.split('-')
      // More than one dash is not a range. Without this, `1-2-3` silently keeps
      // only the first two bounds and is judged a legal range.
      if (bounds.length !== 2) return null
      if (!bounds.every((bound) => /^\s*\d+\s*$/.test(bound))) return null
      start = Number(bounds[0])
      end = Number(bounds[1])
    } else {
      // Number() would also accept '', '0x0' and '1e1' as 0, 0 and 10, letting a
      // malformed field pass as a single legal value. Only a plain decimal is
      // a bare number in cron.
      if (!/^\s*\d+\s*$/.test(range)) return null
      start = Number(range)
      end = start
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    if (start < min || end > max || start > end) return null

    for (let value = start; value <= end; value += step) values.add(value)
  }

  return values
}

// Returns a human readable reason when the expression can fire more than once
// in a day, otherwise null. The judgement is made by expanding the fields
// rather than by comparing strings, so `*`, `*/1`, `*/5`, `0,30`, `1-30` and
// `0 */2` are all recognised as sub-daily while `0 2 * * *` and `0 8 * * *` are
// not.
function dailyScheduleProblem(schedule) {
  if (typeof schedule !== 'string' || schedule.trim() === '') {
    return 'the schedule is missing or empty'
  }

  const fields = schedule.trim().split(/\s+/)
  if (fields.length !== 5) {
    return `"${schedule}" is not a five-field cron expression`
  }

  const minutes = expandField(fields[0], 0, 59)
  if (!minutes) return `"${schedule}" has an unparseable minute field "${fields[0]}"`

  const hours = expandField(fields[1], 0, 23)
  if (!hours) return `"${schedule}" has an unparseable hour field "${fields[1]}"`

  // The day fields are validated for well-formedness but not for frequency:
  // narrowing them can only make a schedule fire less often than daily, which
  // is already within the Hobby limit.
  const dayFields = [
    ['day-of-month', fields[2], 1, 31],
    ['month', fields[3], 1, 12],
    ['day-of-week', fields[4], 0, 7],
  ]
  for (const [name, field, min, max] of dayFields) {
    if (!expandField(field, min, max)) {
      return `"${schedule}" has an unparseable ${name} field "${field}"`
    }
  }

  if (minutes.size > 1 || hours.size > 1) {
    return (
      `"${schedule}" fires more than once a day: minute field "${fields[0]}" ` +
      `matches ${minutes.size} value(s) and hour field "${fields[1]}" matches ${hours.size}`
    )
  }

  return null
}

// Minute of the day the schedule fires. Only valid once dailyScheduleProblem
// has proven the minute and hour fields each match exactly one value.
function minuteOfDay(schedule) {
  const [minuteField, hourField] = schedule.trim().split(/\s+/)
  const [hour] = expandField(hourField, 0, 23)
  const [minute] = expandField(minuteField, 0, 59)
  return hour * 60 + minute
}

function findHobbyViolations({ file, config, parseError }) {
  const violations = []

  if (parseError) {
    return [`${file} is not valid JSON (${parseError}), so Vercel cannot read it and the build fails`]
  }

  // A present-but-malformed `crons` key is a finding. Treating it as absent would
  // let a config Vercel rejects pass the guard.
  if (config.crons !== undefined && !Array.isArray(config.crons)) {
    return [`${file} has a "crons" key that is not an array; Vercel rejects the config`]
  }

  const crons = Array.isArray(config.crons) ? config.crons : []

  if (crons.length > HOBBY_MAX_CRONS) {
    violations.push(
      `${file} declares ${crons.length} cron jobs; the Vercel Hobby plan allows at most ` +
        `${HOBBY_MAX_CRONS} and the build fails beyond that`,
    )
  }

  // Two entries on one path make Vercel reject the deployment, so a duplicate is
  // a violation in its own right rather than something the count check catches.
  const seenPaths = new Set()
  for (const cron of crons) {
    if (seenPaths.has(cron?.path)) {
      violations.push(`${file} declares the cron path "${cron?.path}" more than once; Vercel rejects the deployment`)
    }
    seenPaths.add(cron?.path)
  }

  for (const cron of crons) {
    const problem = dailyScheduleProblem(cron?.schedule)
    if (problem) {
      violations.push(
        `${file} cron "${cron?.path}" has an illegal Hobby schedule: ${problem}. ` +
          `The Hobby plan rejects sub-daily crons and the build fails`,
      )
    }
  }

  return violations
}

describe('vercel.json cron configuration (Vercel Hobby limits)', () => {
  it('discovers both app vercel.json files so the assertions below are not vacuous', () => {
    const files = CONFIGS.map(({ file }) => file)
    expect(files).toContain('apps/carefind/vercel.json')
    expect(files).toContain('apps/carehub/vercel.json')
  })

  it('declares at most two crons and only daily schedules in every app', () => {
    expect(CONFIGS.flatMap(findHobbyViolations)).toEqual([])
  })
})

describe('the Hobby cron guard', () => {
  it('rejects a sub-daily schedule and names the file, cron path and schedule', () => {
    const violations = findHobbyViolations({
      file: 'apps/carefind/vercel.json',
      config: {
        crons: [
          { path: '/api/cron/process-email-outbox', schedule: '*/5 * * * *' },
          { path: '/api/cron/subscription-expiry', schedule: '0 8 * * *' },
        ],
      },
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('apps/carefind/vercel.json')
    expect(violations[0]).toContain('/api/cron/process-email-outbox')
    expect(violations[0]).toContain('*/5 * * * *')
  })

  it('rejects a third cron and names the app', () => {
    const violations = findHobbyViolations({
      file: 'apps/carehub/vercel.json',
      config: {
        crons: [
          { path: '/api/cron/process-email-outbox', schedule: '0 0 * * *' },
          { path: '/api/cron/subscription-expiry', schedule: '0 8 * * *' },
          { path: '/api/cron/nightly-cleanup', schedule: '0 9 * * *' },
        ],
      },
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('apps/carehub/vercel.json')
    expect(violations[0]).toContain('3 cron jobs')
  })

  it('accepts two daily crons', () => {
    expect(
      findHobbyViolations({
        file: 'apps/carefind/vercel.json',
        config: {
          crons: [
            { path: '/api/cron/process-email-outbox', schedule: '0 2 * * *' },
            { path: '/api/cron/subscription-expiry', schedule: '0 8 * * *' },
          ],
        },
      }),
    ).toEqual([])
  })

  it.each([
    ['* * * * *', true],
    ['*/1 * * * *', true],
    ['*/5 * * * *', true],
    ['0,30 * * * *', true],
    ['1-30 * * * *', true],
    ['0 */2 * * *', true],
    ['*/15 2-6 * * *', true],
    ['0 * * * *', true],
    ['0 2 * * *', false],
    ['0 8 * * *', false],
    ['30 5 * * *', false],
    ['0 0 * * *', false],
    ['0 0 1 * *', false],
    ['0 8 * * 1-5', false],
  ])('reads %s as sub-daily: %s', (schedule, subDaily) => {
    expect(dailyScheduleProblem(schedule) !== null).toBe(subDaily)
  })

  it.each([
    ['* * * *'],
    ['0 2 * *'],
    ['0 2 * * * *'],
    [''],
    ['0 2 * * *garbage'],
    ['0 2 32 * *'],
    ['0 2 * 13 *'],
    ['0 2 * * 9'],
    ['*/0 * * * *'],
    ['0 24 * * *'],
    // Number() reads '', '0x0' and '1e1' as 0, 0 and 10, so each of these would
    // otherwise be accepted as one legal minute value.
    ['/5 * * * *'],
    ['0x0 * * * *'],
    ['1e1 * * * *'],
    // '1-2-3' would silently keep only the first two bounds.
    ['1-2-3 * * * *'],
    ['*/0x5 * * * *'],
  ])('rejects the malformed schedule %j', (schedule) => {
    expect(dailyScheduleProblem(schedule)).not.toBeNull()
  })

  it('reports a non-array crons key instead of treating it as no crons', () => {
    const violations = findHobbyViolations({
      file: 'apps/carefind/vercel.json',
      config: { crons: { path: '/api/cron/process-email-outbox', schedule: '*/5 * * * *' } },
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('not an array')
  })

  it('reports a config that is not valid JSON by name', () => {
    const violations = findHobbyViolations({
      file: 'apps/carehub/vercel.json',
      config: undefined,
      parseError: 'Unexpected token } in JSON at position 4',
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('apps/carehub/vercel.json')
    expect(violations[0]).toContain('not valid JSON')
  })

  it('reports the same cron path declared twice', () => {
    const violations = findHobbyViolations({
      file: 'apps/carefind/vercel.json',
      config: {
        crons: [
          { path: '/api/cron/process-email-outbox', schedule: '0 2 * * *' },
          { path: '/api/cron/process-email-outbox', schedule: '0 4 * * *' },
        ],
      },
    })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('more than once')
  })
})

describe('carefind cron contract', () => {
  // Read defensively so a renamed or removed cron reports a clear assertion
  // failure instead of a TypeError thrown while the suite is still collecting.
  const crons = Array.isArray(CAREFIND?.config?.crons) ? CAREFIND.config.crons : []
  const cronFor = (cronPath) => crons.find((cron) => cron.path === cronPath)

  it('declares exactly the two expected cron paths, at the Hobby maximum', () => {
    expect(crons).toHaveLength(HOBBY_MAX_CRONS)
    expect(crons.map((cron) => cron.path).sort()).toEqual([
      '/api/cron/process-email-outbox',
      '/api/cron/subscription-expiry',
    ])
  })

  it('pins the outbox drain to a daily 02:00 UTC run, not merely to a legal frequency', () => {
    // The Hobby guard above only caps frequency from above, so a schedule
    // narrowed to weekly or monthly — `0 2 1 * *`, `0 2 * * 1` — is legal on
    // Vercel and would pass it. Pinning the whole entry is what actually holds
    // the cadence DEPLOYMENT.md and the deferred-work entry both promise.
    expect(cronFor('/api/cron/process-email-outbox')).toEqual({
      path: '/api/cron/process-email-outbox',
      schedule: '0 2 * * *',
    })
  })

  it('drains the outbox strictly before the expiry scan, so morning expiry mail gets a second drain', () => {
    // Strictly less than, not less-or-equal: identical minutes mean both crons
    // fire together, which is the one arrangement with no second drain that day
    // and so defeats the reason this ordering exists.
    expect(minuteOfDay(cronFor('/api/cron/process-email-outbox').schedule)).toBeLessThan(
      minuteOfDay(cronFor('/api/cron/subscription-expiry').schedule),
    )
  })

  it('leaves the expiry cron, headers and rewrites unchanged', () => {
    expect(cronFor('/api/cron/subscription-expiry')).toEqual({
      path: '/api/cron/subscription-expiry',
      schedule: '0 8 * * *',
    })

    // Pinned because this spec changes neither block. The /api/(.*) rewrite to
    // /api/router is load-bearing: Vercel Hobby allows 12 serverless functions
    // and CareFind folds every route into that one file (see api/router.js).
    expect(CAREFIND.config.headers).toEqual([
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '0' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        source: '/assets/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/fonts/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
      { source: '/icon-512.png', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
      { source: '/icon-192.png', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
      { source: '/manifest.json', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
    ])

    expect(CAREFIND.config.rewrites).toEqual([
      { source: '/api/(.*)', destination: '/api/router' },
      {
        source: '/(.*)',
        has: [
          {
            type: 'header',
            key: 'user-agent',
            value:
              '.*(facebookexternalhit|facebookcatalog|Facebot|meta-externalagent|WhatsApp|LinkedInBot|Twitterbot|Slackbot|Slack-ImgProxy|TelegramBot|Discordbot|Pinterest|redditbot|SkypeUriPreview|embedly|iframely|vkShare|Quora Link Preview).*',
          },
        ],
        destination: '/api/router',
      },
      { source: '/(.*)', destination: '/index.html' },
    ])
  })
})
