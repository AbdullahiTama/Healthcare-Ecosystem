// Committed evidence for D1 AC3 (spec-d1-business-dashboard-foundation):
// the KPI row must wrap 4 → 4 → 3 → 2 at 1280 / 1024 / 768 / 375 with no
// horizontal overflow. jsdom cannot observe layout, and the earlier Chromium
// measurement was transient, so the check lives here: a real browser measuring
// a harness whose GRID GEOMETRY is extracted from the real source files on
// every run. If MetricGrid's formula, DashboardHome's minColumn, the quick-action
// grid, the shell nav widths or the page padding drift, extraction fails loudly
// instead of measuring a stale copy.
//
// Run:  node apps/carehub/scripts/verify-dashboard-grid.mjs
//
// Requires playwright-core plus a system Chromium (Edge or Chrome on Windows).
// playwright-core is resolved from apps/carefind on purpose — it was installed
// there --no-save for the landing-page audit, and this repo has no E2E
// infrastructure to own a new dependency.

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SCRIPT_DIR, '..', '..', '..')

// ---------------------------------------------------------------------------
// Source extraction — every value the harness lays out with comes from here.
// A failed match is a drift guard, not a warning.
// ---------------------------------------------------------------------------
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

function must(label, re, src, file) {
  const m = src.match(re)
  if (!m) {
    throw new Error(
      `Drift guard: could not extract ${label} from ${file}.\n` +
      `The probe measures source-extracted geometry; update it to match the component.`,
    )
  }
  return m
}

const themeSrc = read('packages/design-system/src/theme.js')
const metricGridSrc = read('packages/design-system/src/components/dashboard/MetricGrid.jsx')
const dashboardHomeSrc = read('apps/carehub/src/modules/dashboard-home/DashboardHome.jsx')
const businessDashboardSrc = read('apps/carehub/src/pages/dashboard/BusinessDashboard.jsx')
const shellSrc = read('packages/design-system/src/components/dashboard/DashboardShell.jsx')

const spaceBlock = must('the theme space scale', /space:\s*\{([^}]*)\}/, themeSrc, 'theme.js')[1]
const SPACE_8 = Number(must('space[8] (KPI grid gap)', /\b8:\s*(\d+)/, spaceBlock, 'theme.js (space block)')[1])
const RADIUS_LG = Number(must('radius.lg', /lg:\s*(\d+)/, themeSrc, 'theme.js')[1])
const TABLET = Number(must('breakpoints.tablet', /tablet:\s*(\d+)/, themeSrc, 'theme.js')[1])
const LAPTOP = Number(must('breakpoints.laptop', /laptop:\s*(\d+)/, themeSrc, 'theme.js')[1])

// MetricGrid's own template + the minColumn branch of `min`. Assert the exact
// strings the component ships: if either changes, the harness must be updated.
must(
  'the gridTemplateColumns template',
  /gridTemplateColumns: `repeat\(auto-fit, minmax\(\$\{min\}, 1fr\)\)`/,
  metricGridSrc,
  'MetricGrid.jsx',
)
must(
  'the minColumn pixel-floor branch',
  /`min\(\$\{minColumn \?\? theme\.dashboard\.metricMin\}px, 100%\)`/,
  metricGridSrc,
  'MetricGrid.jsx',
)

const MIN_COLUMN = Number(must('DashboardHome minColumn', /<MetricGrid[^>]*minColumn=\{(\d+)\}/, dashboardHomeSrc, 'DashboardHome.jsx')[1])
const quickMatch = must('the quick-action grid', /gridTemplateColumns: 'repeat\((\d+), 1fr\)', gap: (\d+)/, dashboardHomeSrc, 'DashboardHome.jsx')
const QUICK_COLS = Number(quickMatch[1])
const QUICK_GAP = Number(quickMatch[2])
const twoColMatch = must('the worklist/right-column grid', /gridTemplateColumns: isMobile \? '([^']+)' : '([^']+)', gap: (\d+)/, dashboardHomeSrc, 'DashboardHome.jsx')
const TWO_COL_MOBILE = twoColMatch[1]
const TWO_COL_DESKTOP = twoColMatch[2]
const TWO_COL_GAP = Number(twoColMatch[3])
const padMatch = must('the home content padding', /padding: isMobile \? (\d+) : (\d+)/, dashboardHomeSrc, 'DashboardHome.jsx')
const PAD_MOBILE = Number(padMatch[1])
const PAD_DESKTOP = Number(padMatch[2])

must('gutter={0}', /gutter=\{0\}/, businessDashboardSrc, 'BusinessDashboard.jsx')
must('collapsed={isTablet}', /collapsed=\{isTablet\}/, businessDashboardSrc, 'BusinessDashboard.jsx')
const NAV_W = Number(must('navWidth', /navWidth=\{(\d+)\}/, businessDashboardSrc, 'BusinessDashboard.jsx')[1])
const NAV_COLLAPSED = Number(must('navCollapsedWidth', /navCollapsedWidth=\{(\d+)\}/, businessDashboardSrc, 'BusinessDashboard.jsx')[1])
const CONTENT_MAX = Number(must('contentMaxWidth', /contentMaxWidth:\s*(\d+)/, themeSrc, 'theme.js')[1])

// The shell must expose overflow (auto), not clamp it (hidden) — that is what
// makes "no horizontal overflow" an observable assertion.
must('overflowX: auto on the content scroller', /overflowY: 'auto', overflowX: 'auto'/, shellSrc, 'DashboardShell.jsx')

// The D1 KPI grid CSS as MetricGrid computes it for this page (minColumn set,
// no `columns`): repeat(auto-fit, minmax(min(<minColumn>px, 100%), 1fr)).
const KPI_TEMPLATE = `repeat(auto-fit, minmax(min(${MIN_COLUMN}px, 100%), 1fr))`

// Human-ratified wrap (decision B, 2026-09-29): today's sequence.
const EXPECTED_COLS = { 375: 2, 768: 3, 1024: 4, 1280: 4 }
const WIDTHS = Object.keys(EXPECTED_COLS).map(Number)

// ---------------------------------------------------------------------------
// Harness — representative tile chrome, source-extracted grid geometry.
// ---------------------------------------------------------------------------
const CANDIDATE_BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildHtml() {
  const kpi = [
    ['Sales today', '\u20A648,300', '12 transactions'],
    ['Held sales', '2', 'waiting at counter'],
    ['Owed to you', '\u20A69,200', '3 credit sales open'],
    ['Stock alerts', '3', '1 out of stock'],
  ]
    .map(([label, value, sub]) => `
      <div class="card stat">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value">${esc(value)}</div>
        <div class="stat-sub">${esc(sub)}</div>
      </div>`)
    .join('')

  const worklist = ['Paracetamol is out of stock', 'Ibuprofen running low', 'Amoxicillin running low']
    .map((t) => `<div class="row"><span class="row-title">${esc(t)}</span><span class="badge">Restock</span></div>`)
    .join('')

  const quick = ['Add product', 'Add expense', 'Export report']
    .map((label) => `
      <button type="button" class="quick">
        <span class="quick-tile"></span>
        <span class="quick-label">${esc(label)}</span>
      </button>`)
    .join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f6f7f5; }
  .shell { display: flex; height: 100vh; overflow: hidden; background: #f6f7f5; }
  .nav { flex-shrink: 0; height: 100%; overflow-y: auto; overflow-x: hidden; background: #fff; border-right: 1px solid #ECEAE0; }
  .col { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .scroller { flex: 1; overflow-y: auto; overflow-x: auto; }
  main { max-width: ${CONTENT_MAX}px; margin: 0 auto; padding: 0; box-sizing: border-box; }
  .topbar { padding: 14px 24px; background: #fff; border-bottom: 1px solid #ECEAE0; font-weight: 800; color: #0E2A47; }
  .page { display: flex; flex-direction: column; gap: 18px; }
  .card { background: #fff; border: 1px solid #ECEAE0; border-radius: ${RADIUS_LG}px; box-shadow: 0 1px 4px rgba(15,23,42,0.05); box-sizing: border-box; }
  #kpi { display: grid; grid-template-columns: ${KPI_TEMPLATE}; gap: ${SPACE_8}px; }
  .stat { padding: 18px; }
  .stat-label { font-size: 12px; font-weight: 600; color: #8B978F; }
  .stat-value { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: #0E2A47; line-height: 1.1; }
  .stat-sub { font-size: 11.5px; color: #9aa5ad; margin-top: 5px; }
  #cols { display: grid; grid-template-columns: ${TWO_COL_DESKTOP}; gap: ${TWO_COL_GAP}px; align-items: stretch; }
  .sect { padding: 16px; min-width: 0; }
  .sect h2 { font-size: 15px; font-weight: 800; margin: 0 0 10px; color: #0E2A47; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #ECEAE0; }
  .row:last-child { border-bottom: none; }
  .row-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { flex-shrink: 0; padding: 7px 14px; border: 1px solid #ECEAE0; border-radius: 10px; background: #fff; font-size: 12px; font-weight: 700; }
  #quick { display: grid; grid-template-columns: repeat(${QUICK_COLS}, 1fr); gap: ${QUICK_GAP}px; }
  .quick { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; width: 100%; padding: ${SPACE_8}px; border-radius: ${RADIUS_LG}px; background: #fff; border: 1px solid #ECEAE0; box-shadow: 0 1px 4px rgba(15,23,42,0.05); box-sizing: border-box; text-align: left; font-family: inherit; min-width: 0; }
  .quick-tile { width: 36px; height: 36px; border-radius: 10px; background: #E3EEE8; flex-shrink: 0; }
  .quick-label { font-size: 14px; font-weight: 700; color: #1a2b3c; }
</style>
</head>
<body>
  <div class="shell">
    <div class="nav" id="nav"></div>
    <div class="col">
      <div class="scroller" id="scroller">
        <main>
          <div class="topbar">Lagos branch</div>
          <div class="page" id="page">
            <div id="kpi" role="group" aria-label="Key metrics">${kpi}</div>
            <div id="cols">
              <div class="card sect">
                <h2>Needs your attention</h2>
                ${worklist}
              </div>
              <div style="min-width:0; display:flex; flex-direction:column; gap:16px;">
                <div class="card sect">
                  <h2>Recent sales</h2>
                  <div class="row"><span class="row-title">Walk-in</span><span class="badge">View all</span></div>
                </div>
                <div id="quick">${quick}</div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
  <script>
    // Mirrors BusinessDashboard: collapsed={isTablet}, navWidth, navCollapsedWidth,
    // mobile hands the rail away with display:contents (DashboardShell).
    // The worklist/right-column grid also switches branches on isMobile
    // (DashboardHome), so both grid rules are applied from the same breakpoint.
    const TABLET = ${TABLET}, LAPTOP = ${LAPTOP}
    const NAV_W = ${NAV_W}, NAV_COLLAPSED = ${NAV_COLLAPSED}
    const PAD_MOBILE = ${PAD_MOBILE}, PAD_DESKTOP = ${PAD_DESKTOP}
    const TWO_COL_MOBILE = '${TWO_COL_MOBILE}'
    const TWO_COL_DESKTOP = '${TWO_COL_DESKTOP}'
    function applyChrome() {
      const w = window.innerWidth
      const mobile = w < TABLET
      const tablet = w >= TABLET && w < LAPTOP
      const nav = document.getElementById('nav')
      nav.style.display = mobile ? 'contents' : 'block'
      nav.style.width = mobile ? '' : (tablet ? NAV_COLLAPSED + 'px' : NAV_W + 'px')
      document.getElementById('page').style.padding = (mobile ? PAD_MOBILE : PAD_DESKTOP) + 'px'
      document.getElementById('cols').style.gridTemplateColumns = mobile ? TWO_COL_MOBILE : TWO_COL_DESKTOP
    }
    applyChrome()
    window.addEventListener('resize', applyChrome)
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------
const MEASURE = () => {
  const kpi = document.getElementById('kpi')
  const tiles = [...kpi.children]
  const lefts = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().left)))
  const scroller = document.getElementById('scroller')
  const quick = document.getElementById('quick')
  return {
    columns: lefts.size,
    kpiOverflow: kpi.scrollWidth > kpi.clientWidth + 1,
    quickOverflow: quick.scrollWidth > quick.clientWidth + 1,
    scrollerOverflow: scroller.scrollWidth > scroller.clientWidth + 1,
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    appliedGrid: getComputedStyle(kpi).gridTemplateColumns,
    navWidth: Math.round(document.getElementById('nav').getBoundingClientRect().width),
  }
}

async function main() {
  // `--dump-html` prints the harness page (useful when chasing an overflow
  // finding) and stops before launching a browser.
  if (process.argv.includes('--dump-html')) {
    console.log(buildHtml())
    return
  }

  const executablePath = CANDIDATE_BROWSERS.find((p) => existsSync(p))
  if (!executablePath) {
    throw new Error(
      `No system Chromium found. Looked in:\n  ${CANDIDATE_BROWSERS.join('\n  ')}\n` +
      'Install Chrome/Edge, or run `npx playwright install chromium`.',
    )
  }

  const require = createRequire(join(ROOT, 'apps', 'carefind', 'package.json'))
  const { chromium } = require('playwright-core')

  const html = buildHtml()
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  console.log('D1 KPI grid probe — source-extracted geometry, real Chromium')
  console.log(`  minColumn=${MIN_COLUMN}  gap=${SPACE_8}  nav=${NAV_W}/${NAV_COLLAPSED}  ` +
    `quick=${QUICK_COLS}-up gap ${QUICK_GAP}  padding ${PAD_MOBILE}/${PAD_DESKTOP}`)
  console.log(`  kpi grid-template-columns: ${KPI_TEMPLATE}`)
  console.log('')

  const failures = []
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.waitForTimeout(150)
    const m = await page.evaluate(MEASURE)

    const expected = EXPECTED_COLS[width]
    const colsOk = m.columns === expected
    const overflowOk = !m.kpiOverflow && !m.quickOverflow && !m.scrollerOverflow && !m.docOverflow
    const ok = colsOk && overflowOk
    if (!ok) failures.push(`${width}px`)

    console.log(
      `${ok ? 'ok      ' : 'FAIL    '}${String(width).padStart(5)}px  ` +
      `columns=${m.columns} (expected ${expected})  nav=${m.navWidth}px  ` +
      `overflow: kpi=${m.kpiOverflow} quick=${m.quickOverflow} scroller=${m.scrollerOverflow} doc=${m.docOverflow}`,
    )
    if (!ok) {
      console.log(`          applied: ${m.appliedGrid}`)
    }
    await context.close()
  }

  await browser.close()

  if (failures.length) {
    console.log(`\nFAIL — AC3 broken at: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nPass — KPI wrap 4/4/3/2 at 1280/1024/768/375, no horizontal overflow at any width.')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(2)
})
