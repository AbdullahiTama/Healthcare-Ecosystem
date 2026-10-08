// Real-browser responsive audit for the CareFind landing page.
//
// Why this exists: the landing page was first reviewed by structural reasoning
// about minmax(0, …) tracks and minWidth: 0, which is not evidence. This
// launches a real browser against the built app and measures what actually
// overflows at each breakpoint, naming the offending element.
//
// Run:  node scripts/audit-landing-overflow.mjs          (dev server must be up)
//       node scripts/audit-landing-overflow.mjs http://localhost:4173
//
// Requires playwright-core plus a system Chromium (Edge or Chrome on Windows).
// playwright-core is installed with --no-save on purpose: this is a diagnostic
// harness, not a test dependency, and the repo has no E2E infrastructure.

import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = process.argv[2] || 'http://localhost:4173'
const PATH = process.env.AUDIT_PATH || '/'

// The widths the design system defines a behaviour for (theme.breakpoints).
const WIDTHS = [320, 375, 390, 768, 1024, 1440]

const CANDIDATE_BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

// Measured in the page: every element whose right edge extends past the
// viewport, or whose own content is wider than its box.
const PROBE = () => {
  const vw = document.documentElement.clientWidth
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const style = getComputedStyle(el)
    if (style.position === 'fixed') continue
    // An element wider than the viewport is only a defect if the page does not
    // already clip it (a deliberately scrollable strip such as MarketplaceTabs
    // is legitimate).
    if (r.right > vw + 1) {
      const scrollableAncestor = el.closest('[style*="overflow"], [style*="overflowx"]')
      if (scrollableAncestor && scrollableAncestor !== el) continue
      offenders.push({
        tag: el.tagName.toLowerCase(),
        section: el.closest('[data-section]')?.dataset.section || 'page-chrome',
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.textContent || '').trim().slice(0, 48),
      })
    }
  }
  return {
    vw,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    offenders: offenders.slice(0, 12),
  }
}

// Accessibility probe: interactive elements must be reachable by keyboard and
// carry a visible focus indicator. An inline `outline: 'none'` outranks the
// stylesheet's :focus-visible rule and silently kills the ring
// (docs/design/ACCESSIBILITY.md:16), which is exactly the kind of defect that
// a visual review misses and a real browser catches.
const A11Y_PROBE = () => {
  const focusables = Array.from(
    document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })

  const noRing = []
  const tooSmall = []

  for (const el of focusables) {
    // Touch target floor (ACCESSIBILITY.md:32). Desktop icon buttons are
    // allowed 32px, so the threshold is deliberately the mobile 44px.
    const r = el.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) {
      // Ignore inline text links, which the guideline exempts.
      const looksLikeTextLink = el.tagName === 'A' && el.textContent.trim().length > 3
        && getComputedStyle(el).display === 'inline'
      if (!looksLikeTextLink) {
        tooSmall.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        })
      }
    }
  }

  return { noRing, tooSmall, focusableCount: focusables.length }
}

async function auditFocusRings(page) {
  return page.evaluate(async () => {
    const els = Array.from(
      document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const missing = []
    for (const el of els.slice(0, 40)) {
      el.focus()
      const s = getComputedStyle(el)
      const width = parseFloat(s.outlineWidth) || 0
      const style = s.outlineStyle
      const hasShadow = s.boxShadow && s.boxShadow !== 'none'
      // A focusable control with no outline and no shadow is invisible while
      // focused. Programmatic .focus() does not always set :focus-visible, so
      // this is a heuristic — but it catches an inline `outline: none`, which
      // overrides the stylesheet even without the pseudo-class matching.
      if (style === 'none' && !hasShadow) {
        missing.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40))
      }
      el.blur()
    }
    return { checked: Math.min(els.length, 40), missing }
  })
}

async function main() {
  const executablePath = CANDIDATE_BROWSERS.find((p) => existsSync(p))
  if (!executablePath) {
    throw new Error(
      `No system Chromium found. Looked in:\n  ${CANDIDATE_BROWSERS.join('\n  ')}\n`
      + 'Install Chrome/Edge, or run `npx playwright install chromium`.',
    )
  }

  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  let overflowCount = 0
  let a11yCount = 0
  let focusCount = 0

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    // `networkidle` is unreliable here: Leaflet tile requests and the Sentry
    // pipeline can keep the connection warm past the default timeout. Wait for
    // the DOM, then for the hero to actually exist, which is the real signal
    // that React has painted.
    await page.goto(`${BASE}${PATH}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('[data-section="hero"], main', { timeout: 30000 })
    // Let reveals settle, then measure twice: once at the top, once scrolled to
    // the bottom, because lazily-rendered lower sections are the usual culprits.
    await page.waitForTimeout(600)
    const top = await page.evaluate(PROBE)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(700)
    const bottom = await page.evaluate(PROBE)
    const a11y = await page.evaluate(A11Y_PROBE)
    const focus = await auditFocusRings(page)

    const worstScrollWidth = Math.max(top.documentScrollWidth, bottom.documentScrollWidth)
    const overflow = worstScrollWidth > width + 1
    if (overflow) overflowCount += 1
    if (a11y.tooSmall.length) a11yCount += 1
    if (focus.missing.length) focusCount += 1

    const status = overflow || a11y.tooSmall.length || focus.missing.length ? 'ISSUES   ' : 'ok       '
    console.log(
      `${status} ${String(width).padStart(4)}px  scrollWidth=${worstScrollWidth}  ` +
      `overflow=${(top.offenders.length + bottom.offenders.length)}  ` +
      `small=${a11y.tooSmall.length}/${a11y.focusableCount}  noRing=${focus.missing.length}/${focus.checked}` +
      `${consoleErrors.length ? `  pageErrors=${consoleErrors.length}` : ''}`,
    )
    for (const o of [...top.offenders, ...bottom.offenders].slice(0, 4)) {
      console.log(`         ↳ overflow [${o.section}] <${o.tag}> w=${o.width} right=${o.right} "${o.text}"`)
    }
    for (const o of a11y.tooSmall.slice(0, 10)) {
      console.log(`         ↳ small  <${o.tag}> ${o.w}x${o.h} "${o.label}"`)
    }
    for (const m of focus.missing.slice(0, 4)) {
      console.log(`         ↳ noRing "${m}"`)
    }
    for (const e of consoleErrors.slice(0, 2)) console.log(`         ! ${e}`)

    await context.close()
  }

  await browser.close()
  const problems = []
  if (overflowCount) problems.push(`${overflowCount} breakpoint(s) overflow horizontally`)
  if (a11yCount) problems.push(`${a11yCount} breakpoint(s) have sub-44px touch targets`)
  if (focusCount) problems.push(`${focusCount} breakpoint(s) have focusables with no visible focus ring`)
  console.log(problems.length ? `\n${problems.join('\n')}` : '\nClean: no overflow, all touch targets >= 44px, all focus rings visible.')
  process.exit(problems.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
