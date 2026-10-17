// First party UI copy audit.
//
//   node scripts/audit-ui-copy.mjs
//   node scripts/audit-ui-copy.mjs --app=carehub --format=json
//   node scripts/audit-ui-copy.mjs --include-tests
//
// Answers one question precisely: does any string that a human actually reads
// in CareFind or CareHub contain a dash character?
//
// It is a PARSER, not a search and replace. Every string in the tree is visited
// through the Babel AST and only strings that can reach a rendered surface are
// inspected. Identifiers, routes, CSS classes, query keys, Supabase columns,
// SQL, seed ids and imported third party copy are never considered, so a hit in
// this report is always a real editing task.
//
// Three classes of finding:
//   DASH       em/en/figure/horizontal bar/minus/soft hyphen, or " - " as a
//              separator. Must be zero. Rewrite the sentence.
//   HYPHEN     a hyphenated compound in visible copy. Often correct British
//              English ("point-of-care"), so these are advisory: either rewrite
//              the sentence or add the term to LEGITIMATE_COMPOUNDS with a
//              reason.
//   AI_COPY    a visible phrase carrying a pattern this project has decided not
//              to ship: hollow marketing filler, "not just X, but Y", invented
//              certainty. Advisory, judged by a human.
//
// Exit code 0 when there are no DASH findings, else 1.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d) => (argv.find((a) => a.startsWith(`--${n}=`)) || `=${d}`).split('=')[1] ?? d

// ── parsing ──────────────────────────────────────────────────────────────────
// @babel/parser ships inside each app's node_modules (via @vitejs/plugin-react).
// Resolve it from an app rather than adding a dependency to the root, which has
// no package.json of its own.
function loadParser() {
  for (const app of ['carehub', 'carefind']) {
    const req = createRequire(path.join(ROOT, 'apps', app, 'package.json'))
    try {
      return req('@babel/parser')
    } catch { /* try the next app */ }
  }
  throw new Error(
    'Cannot resolve @babel/parser. Run `npm install` inside apps/carehub (or apps/carefind). ' +
    'This audit parses the AST rather than pattern matching so it never flags a route path or a CSS class as copy.'
  )
}

// ── scope ────────────────────────────────────────────────────────────────────
const SCAN_ROOTS = [
  'apps/carefind/src',
  'apps/carehub/src',
  'apps/carefind/api',
  'apps/carehub/api',
  'packages/design-system/src',
  'packages/shared-email/src',
  'packages/shared-notifications/src',
  'packages/shared-marketplace/src',
  'packages/shared-payments/src',
  'packages/shared-payout-ui/src',
].filter((p) => existsSync(path.join(ROOT, p)))

const onlyApp = opt('app', '')
const includeTests = flag('include-tests')
const includeCss = flag('include-css')

// ── what counts as a visible surface ─────────────────────────────────────────

// JSX attributes whose value is always read by a person.
const COPY_ATTRS = new Set([
  'title', 'label', 'placeholder', 'alt', 'message', 'heading', 'subtitle',
  'subheading', 'description', 'desc', 'caption', 'tooltip', 'text', 'eyebrow',
  'kicker', 'headline', 'cta', 'ctaLabel', 'buttonText', 'actionText', 'emptyText',
  'emptyMessage', 'emptyTitle', 'emptyDescription', 'helperText', 'helpText',
  'hint', 'errorText', 'errorMessage', 'successMessage', 'confirmText', 'cancelText',
  'confirmLabel', 'cancelLabel', 'srText', 'srOnly', 'screenReaderText', 'aria-label',
  'aria-description', 'aria-roledescription', 'aria-placeholder', 'aria-valuetext',
  'loadingText', 'emptyTitleText', 'intro', 'tagline', 'summaryText', 'detail',
  'details', 'body', 'bodyText', 'content', 'notice', 'note', 'tooltipText',
])

// JSX attributes that are machine facing. Listed explicitly so a future
// attribute does not silently widen the audit by accident.
const NON_COPY_ATTRS = new Set([
  'id', 'key', 'name', 'type', 'variant', 'size', 'color', 'href', 'to', 'path', 'route',
  'src', 'method', 'status', 'icon', 'component', 'as', 'target', 'rel', 'role', 'mode',
  'shape', 'tone', 'placement', 'align', 'width', 'height', 'position', 'zIndex', 'opacity',
  'display', 'className', 'style', 'testId', 'data-testid', 'htmlFor', 'colSpan', 'rowSpan',
  'value', 'defaultValue', 'autoComplete', 'maxLength', 'minLength', 'step', 'accept',
  'encType', 'charSet', 'lang', 'dir', 'count', 'limit', 'offset', 'page', 'pageSize', 'sort',
  'order', 'direction', 'format', 'precision', 'currency', 'locale', 'unit', 'scale',
  'threshold', 'retries', 'timeout', 'delay', 'duration', 'quantity', 'qty', 'price', 'amount',
  'fee', 'rate', 'percent', 'stock', 'sku', 'phone', 'email', 'password', 'currencyCode',
])

// Object keys that hold copy in nav configs, toast maps, empty state maps and
// similar lookup tables.
const COPY_KEYS = new Set([...COPY_ATTRS].concat([
  'name', 'text', 'title', 'label', 'body', 'copy', 'message', 'headline', 'intro',
  'tagline', 'summary', 'description', 'detail', 'details', 'hint', 'note', 'notice',
  'instructions', 'guidance', 'warning', 'help', 'prompt', 'question', 'answer',
  'emptyState', 'empty', 'success', 'failure', 'error', 'pending', 'tooltip',
  'loadingText', 'ariaLabel', 'srText', 'statusText', 'actionText', 'buttonText',
]))

// Object keys that never hold copy even though they hold words.
const NON_COPY_KEYS = new Set([
  'id', 'key', 'type', 'variant', 'size', 'color', 'href', 'to', 'path', 'route', 'src',
  'method', 'status', 'icon', 'component', 'as', 'target', 'rel', 'role', 'mode', 'shape',
  'tone', 'placement', 'align', 'className', 'style', 'testId', 'data-testid', 'htmlFor',
  'value', 'defaultValue', 'count', 'limit', 'offset', 'page', 'pageSize', 'sort', 'order',
  'direction', 'format', 'precision', 'currency', 'locale', 'unit', 'scale', 'threshold',
  'retries', 'timeout', 'delay', 'duration', 'quantity', 'qty', 'price', 'amount', 'fee',
  'rate', 'percent', 'stock', 'sku', 'slug', 'filename', 'fileName', 'field', 'column',
  'table', 'schema', 'tableName', 'columnName', 'fn', 'callback', 'handler', 'test',
  'describe', 'it', 'expect', 'matcher', 're', 'regex', 'pattern', 'selector', 'query',
  'event', 'action', 'dispatch', 'store', 'slice', 'reducer', 'state', 'props', 'style',
])

// A string that looks like a token rather than prose.
const TOKENISH = [
  /^[a-z0-9_]+$/,                       // snake_case, lowercase tokens
  /^[A-Z_][A-Z0-9_]*$/,                // CONSTANTS, ENUM_VALUES
  /^[a-z]+([A-Z][a-z0-9]*)+$/,         // camelCase / PascalCase identifiers
  /^[a-z]+(-[a-z]+)+$/,                // kebab-case tokens
  /^[\w.-]*\.[\w.-]+$/,                // file.ext, module paths
  /^[a-z-]+$/,                         // single kebab word
]

// Strings that are definitely machine data even though they contain spaces.
const MACHINE_STRINGS = [
  /^https?:\/\//, /^\/\//, /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i,   // urls, hosts
  /^[./][\w./-]*$/, /^\.{1,2}\//,                              // paths
  /^[#/]/,                                                     // anchors, selectors
  /^[a-z0-9_]+(\.[a-z0-9_]+)+$/,                               // column refs
  /^[-+]?\d/, /^\$|^\u20a6/,                                   // numbers, money
  /^(application|text|image|multipart)\//,                     // mime
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,                 // http verbs
  /^(Bearer|Basic|token)\s?/i,
  /^[a-f0-9]{8,}$/i,                                           // hashes, hex
  /^\+?[\d\s()-]{7,}$/,                                        // phone numbers
  /^[\w.+-]+@[\w.-]+/,                                         // emails
  /^[A-Za-z0-9+/]{16,}={0,2}$/,                                // base64 blobs
  /^\s*[{[]/, /^\s*[)}\]]/,                                    // json fragments
  /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)+$/,                   // member access
  /^[a-zA-Z_$][\w$]*\s*[:=]\s*/,                               // assignments
  /^\(\s*(?:min|max|prefers)-/i,                                // css media feature, e.g. "(prefers-reduced-motion: reduce)"
  /"[A-Za-z_]+"\s*:/,                                           // quoted json key: an LLM prompt or payload, not screen copy
]

// Strings that live in a style object or a CSS file rather than on screen.
// These contain the spaced hyphen or hyphenated token that the dash rule would
// otherwise flag ("border-color 0.2s", "calc(100vh - 64px)").
const STYLE_VALUE = [
  /\b(calc|var|rgb|rgba|hsl|hsla|linear-gradient|radial-gradient|cubic-bezier|clamp|min|max|minmax|repeat|url|env|attr|counter)\s*\(/i,
  /^[-+]?[\d.]+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|cm|mm|deg|ms|s|fr)?$/,
  /^\s*[\d.]+\s*[-+]\s*[\d.]+[a-z%]+\s*$/,                     // "100vh - 64px"
  /^\s*#[\da-f]{3,8}\s*$/i,                                     // hex colours
  /^\s*(solid|dashed|dotted|double|none|auto|inherit|initial|unset|normal|bold|italic|center|flex|grid|block|inline|absolute|relative|fixed|sticky|hidden|pointer|wait|forwards|infinite|linear|ease|ease-in|ease-out|ease-in-out)\s*$/i,
  /[\d.]+(px|rem|em|vh|vw|%)\b/,                                // contains a CSS unit
  /\b\d*\.?\d+m?s\s+[a-z-]+/,                                   // "140ms ease", "0.2s ease"
  /\b(margin|padding|border|background|opacity|transform|transition|box-shadow|color|top|left|right|bottom|width|height|display|flex|grid|gap|font)\b[^ ]*\s*[: ]\s*\S/,
  /^[-a-z]+(\s*,\s*[-a-z]+)+$/,                                // keyword lists
]

// Bare punctuation with no words: separators, bullets, ellipses.
const PUNCT_ONLY = /^[\p{P}\p{S}\s\u2014\u2013\u2012\u2015\u2212\u00ad]+$/u

// Placeholder and reference formats that are not prose at all.
const FORMAT_STRING = [
  /^[A-Z]{2,}[-_]?[xX*#]{2,}$/,                                // CF-xxxxxx, REF-***, X-####
  /^[A-Z]{2,}-\d+$/,                                            // NA-1234
  /^x{2,}$/i,
]

// Personal names. Nigerian surnames are commonly hyphenated ("Ade-Williams"),
// and sample data uses real looking names. A name is not copy, so it must never
// be rewritten to satisfy the dash rule.
const PERSON_NAME = [
  /^(?:Mr|Mrs|Ms|Dr|Prof|Alhaji|Haji|Alhaja|Barr|Smt)\.?\s+[A-Z]/,
  /^(?:e\.g\.|i\.e\.|eg)\s+[A-Z]/,                              // "e.g. Dr. John Ade-Williams"
  /^[A-Z][a-z]+-[A-Z][a-z]+\s+[A-Z]/,                           // Surname-first full name
]

// ── dash rules ───────────────────────────────────────────────────────────────
const DASH_CHARS = {
  '\u2014': 'em dash',
  '\u2013': 'en dash',
  '\u2012': 'figure dash',
  '\u2015': 'horizontal bar',
  '\u2212': 'minus sign',
  '\u00ad': 'soft hyphen',
}
const DASH_RE = /[\u2014\u2013\u2012\u2015\u2212\u00ad]/
const SPACED_HYPHEN_RE = /(^|\s)[-]\s|[-]$/
// A hyphen joining two word characters: "Real-time", "low-stock", "e-prescription".
const HYPHEN_RE = /(?<=[A-Za-z0-9\u00c0-\u024f])-(?=[A-Za-z\u00c0-\u024f])/

// Compounds that are correct British/Nigerian English and must survive the
// hyphen pass. Each entry needs a reason: the audit prints it on every hit.
const LEGITIMATE_COMPOUNDS = {
  // Clinical and regulatory
  'point-of-care': 'established clinical term',
  'life-threatening': 'standard clinical adjective (WHO grade criterion)',
  'adverse-drug-reaction': 'regulatory term',
  'covid': 'WHO disease name',
  'covid-19': 'WHO disease name',
  'follow-up': 'established clinical term',
  'pre-eclampsia': 'established obstetric term',
  'non-steroidal': 'established pharmaceutical term',

  // British and Nigerian English spellings
  'well-being': 'standard British English spelling',
  'organisation': 'not a hyphenated compound (see MACHINE_STRINGS - may need review)',
  'pay-as-you-go': 'standard Nigerian billing term',

  // Product and commercial terms that are the name itself
  'e-prescription': 'established term in Nigerian digital health',
  'all-in-one': 'standard product term',
  'point-of-sale': 'established retail term',
  'security-definer': 'PostgreSQL function attribute, must keep its hyphen',

  // Technical specifications shown to users
  '256-bit': 'security specification (TLS key length)',
  'two-factor': 'established term',
  'one-time': 'established term',

  // Correct verb/adjective forms
  're-record': 'correct spelling of the verb',
  're-login': 'correct spelling of the verb',
  're-open': 'correct spelling of the verb',
  'subscriber-only': 'correct adjective usage',
  'read-only': 'correct adjective usage for a view-only screen',
  'real-world': 'standard English compound',
  'top-level': 'standard engineering term',
  'self-register': 'correct verb form used as a CTA',
  'co-host': 'correct verb form (co-host a live session)',
  '6-digit': 'correct numeric compound for a one time code',
  '10-digit': 'correct numeric compound for a Nigerian phone number',
  '11-digit': 'correct numeric compound for a Nigerian phone number',

  // Clinical and pharmacy vocabulary
  'out-of-stock': 'established retail and pharmacy term',
  'walk-in': 'established clinic term',
  'self-treatment': 'established clinical term',
  'red-flag': 'clinical term for a warning sign; used adjectivally here',
  'de-challenge': 'established pharmacovigilance term (withdrawal of a suspect drug)',
  're-challenge': 'established pharmacovigilance term (re-administration of a suspect drug)',
  'pre-existing': 'standard medical adjective',
  'non-serious': 'ICH E2B term: a case that is not serious',
  'non-negative': 'standard mathematical adjective',
  'follow-ups': 'established clinical term',
  'x-ray': 'standard medical term',

  // Operational vocabulary that is correct as written
  'check-in': 'established term',
  'sign-in': 'established term',
  'sign-ups': 'established term',
  'at-risk': 'standard English compound',
  'past-due': 'established billing term',
  'pop-up': 'established term',
  'pop-ups': 'established term',
  'right-click': 'standard computing term',
  'hair-care': 'hyphenated category label ("Hair-Care & Salons")',
  'mid-print': 'correct hyphenation of a compound adverb',

  // Identifiers, formats and technical tokens that reach the UI verbatim.
  // These are matched as whole tokens, so the whole token must be listed.
  'healthcare-ecosystem': 'User-Agent product token, must not change',
  'cf-code': 'CareFind referral code placeholder format',
  'cf-topup-8h2k': 'CareFind top-up reference format',
  'ref-kola-21': 'seed reference id format',
  'cf-ord-7781': 'CareFind order reference format',
  'team-agents': 'permission token rendered verbatim in role pickers',
  'team-platform': 'permission token rendered verbatim in role pickers',
  'service-role': 'PostgreSQL role name',
  'platform-admin': 'permission token',
  '2-approver': 'role token (two approver quorum)',
  'yyyy-mm-dd': 'ISO date format shown as a placeholder',
  '2027-06-30': 'example date inside a placeholder',
  'a-z': 'alphabet range in a sort control',
  'z-a': 'reverse alphabet range in a sort control',
  'low-high': 'price sort direction label',
  'high-low': 'price sort direction label',
  'money-check': 'admin feature name',
  'apple-system': 'CSS font stack',
  'sans-serif': 'CSS generic font family',
  'ui-monospace': 'CSS generic font family',

  // Legal and contractual wording, kept verbatim on purpose
  'e-commerce': 'terms and conditions naming, kept as the legal document name',

  // Correct verb forms
  're-apply': 'correct spelling of the verb',
  're-activate': 'correct spelling of the verb',
  're-add': 'correct spelling of the verb',
  're-upload': 'correct spelling of the verb',
}

// ── AI-sounding patterns ─────────────────────────────────────────────────────
// Patterns this project has decided not to ship. Advisory only.
const AI_PATTERNS = [
  { id: 'ai-all-in-one', re: /\ball in one place\b/i, why: 'hollow marketing filler' },
  { id: 'ai-seamless', re: /\bseamlessly\b/i, why: 'unverifiable marketing filler' },
  { id: 'ai-effortless', re: /\beffortless(ly)?\b/i, why: 'unverifiable marketing filler' },
  { id: 'ai-revolutionise', re: /\b(revolutionis|revolutioniz)(e|es|ed|ing)\b/i, why: 'hype' },
  { id: 'ai-unlock', re: /\bunlock (the|your|more)\b/i, why: 'vague benefit claim' },
  { id: 'ai-not-just', re: /\bnot just\b[^.?!]{0,40}\bbut\b/i, why: 'artificial contrast' },
  { id: 'ai-supercharge', re: /\bsupercharge\b/i, why: 'hype' },
  { id: 'ai-empower', re: /\bempower(s|ed|ing)?\b/i, why: 'corporate filler' },
  { id: 'ai-game-changer', re: /\bgame[- ]chang(er|ing)\b/i, why: 'hype' },
  { id: 'ai-best-in-class', re: /\bbest[- ]in[- ]class\b/i, why: 'unverifiable claim' },
  { id: 'ai-world-class', re: /\bworld[- ]class\b/i, why: 'unverifiable claim' },
  { id: 'ai-cutting-edge', re: /\bcutting[- ]edge\b/i, why: 'unverifiable claim' },
  { id: 'ai-state-of-the-art', re: /\bstate[- ]of[- ]the[- ]art\b/i, why: 'unverifiable claim' },
  { id: 'ai-built-to', re: /\bdesigned to\b|\bbuilt to\b|\bcrafted to\b/i, why: 'says nothing about the product' },
  { id: 'ai-take-control', re: /\btake control of\b/i, why: 'vague benefit claim' },
  { id: 'ai-elevate', re: /\belevate(s|d)?\b/i, why: 'corporate filler' },
  { id: 'ai-robust', re: /\brobust\b/i, why: 'unverifiable technical claim' },
  { id: 'ai-leverage', re: /\bleverage(s|d)?\b/i, why: 'corporate filler' },
  { id: 'ai-holistic', re: /\bholistic\b/i, why: 'corporate filler' },
  { id: 'ai-streamline', re: /\bstreamline(s|d)?\b/i, why: 'generic benefit claim' },
  { id: 'ai-redefine', re: /\bredefine(s|d)?\b/i, why: 'hype' },
  { id: 'ai-redesign-the', re: /\bredesigning the future\b/i, why: 'hype' },
  { id: 'ai-your-goal', re: /\byour goal\b/i, why: 'generic CTA filler' },
  { id: 'ai-dive-in', re: /\bdive in(to)?\b/i, why: 'generic CTA filler' },
  // Only flag "get started" when it IS the label, not when it ends a sentence
  // ("Add your warehouses to get started." is ordinary English).
  { id: 'ai-get-started-fast', re: /^(get started|start now|learn more|click here)$/i, why: 'generic CTA that does not say what happens' },
  { id: 'ai-no-credit', re: /\bno credit card\b/i, why: 'unsupported offer claim' },
  { id: 'ai-free-trial', re: /\bfree trial\b/i, why: 'must not claim an offer that may not exist' },
  { id: 'ai-trusted-by', re: /\btrusted by\b/i, why: 'implies endorsement or scale' },
  { id: 'ai-millions-of', re: /\bmillions of (users|customers|patients)\b/i, why: 'fabricated statistic' },
  { id: 'ai-thousands-of', re: /\bthousands of (users|customers|patients)\b/i, why: 'fabricated statistic' },
  { id: 'ai-100-percent', re: /\b100% (secure|accurate|reliable|uptime|guaranteed)\b/i, why: 'implied guarantee' },
  { id: 'ai-guaranteed', re: /\bguarantee(d|s)?\b/i, why: 'implied guarantee' },
  { id: 'ai-testimonial', re: /^["\u201c].{15,}["\u201d]$/, why: 'check this is a real quote, not invented' },
  { id: 'ai-eyebrow-everywhere', re: /^[A-Z][A-Z\s]{3,20}$/, why: 'shouted eyebrow label, check hierarchy' },
]

// ── classification ───────────────────────────────────────────────────────────
function looksLikeProse(s) {
  const t = s.trim()
  if (t.length < 3) return false
  if (!/\p{L}/u.test(t)) return false            // no letters at all
  if (PUNCT_ONLY.test(t)) return false          // separators and bullets
  if (FORMAT_STRING.some((r) => r.test(t))) return false
  if (PERSON_NAME.some((r) => r.test(t))) return false
  if (STYLE_VALUE.some((r) => r.test(t))) return false
  if (MACHINE_STRINGS.some((r) => r.test(t))) return false
  if (TOKENISH.some((r) => r.test(t))) return false
  // Real copy is prose: words separated by spaces. A single bare word is a token.
  if (!t.includes(' ')) return /\p{L}{3,}/u.test(t) && /^[A-Z]/.test(t)
  return true
}

// Only the static text of a literal is inspected. If a literal interpolates a
// variable, the variable's runtime value is user data and out of scope; the
// surrounding static words are still first party and still checked.
function literalFragments(node) {
  const out = []
  if (node.type === 'StringLiteral' || node.type === 'Literal' && typeof node.value === 'string') {
    out.push({ text: String(node.value), dynamic: false })
  } else if (node.type === 'TemplateLiteral') {
    for (const q of node.quasis) {
      if (q.value.cooked) out.push({ text: q.value.cooked, dynamic: true })
    }
  } else if (node.type === 'JSXText') {
    out.push({ text: node.value, dynamic: false })
  }
  return out.filter((f) => f.text.trim().length > 0)
}

// A string passed to a developer channel is a diagnostic, not copy: a thrown
// Error, or a call on console or logger. Such strings are logged or caught and
// are never the words a person reads on screen, so the copy rules do not apply.
function isDeveloperChannel(parent) {
  if (!parent) return false
  if (parent.type === 'NewExpression' && parent.callee?.name === 'Error') return true
  if (parent.type !== 'CallExpression' && parent.type !== 'OptionalCallExpression') return false
  const callee = parent.callee
  if (callee?.type !== 'MemberExpression' && callee?.type !== 'OptionalMemberExpression') return false
  return callee.object?.name === 'console' || callee.object?.name === 'logger'
}

// Directories that never reach a rendered surface. Test harnesses, fixtures and
// mutation seeds hold SQL, query builders and expected values. Inspecting them
// for copy would flag every " - " in a WHERE clause.
const NON_RENDERED_DIRS = new Set([
  'node_modules', 'dist', '.vite', '__tests__', '__mocks__',
  'test', 'tests', 'fixtures', 'mocks', 'mutation', 'e2e', 'coverage',
])

// ── file walking ─────────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (NON_RENDERED_DIRS.has(entry.name)) continue
      walk(full, acc)
    } else if (/\.(jsx?|mjs|cjs)$/.test(entry.name)) {
      if (!includeTests && /\.test\.|\.spec\./.test(entry.name)) continue
      acc.push(full)
    } else if (includeCss && /\.css$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

// ── the walk ─────────────────────────────────────────────────────────────────
const parser = loadParser()

function auditFile(file) {
  const src = readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')

  if (file.endsWith('.css')) {
    // CSS has no user facing copy except content: "..." which this project does
    // not use. Skip content but keep the hook so the scope stays explicit.
    return []
  }

  let ast
  try {
    ast = parser.parse(src, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
    })
  } catch (err) {
    return [{ file: rel, line: 0, kind: 'PARSE_ERROR', text: String(err.message).slice(0, 160), source: 'unparsed' }]
  }

  const findings = []
  const seen = new Set()

  const report = (node, source, text, kind) => {
    const line = node.loc?.start?.line ?? 0
    const key = `${kind}\u0000${line}\u0000${text.trim()}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ file: rel, line, kind, text: text.trim(), source })
  }

  const inspect = (node, source) => {
    for (const frag of literalFragments(node)) {
      const text = frag.text
      if (DASH_RE.test(text)) {
        const which = Object.entries(DASH_CHARS).find(([c]) => text.includes(c))?.[1] ?? 'dash'
        report(node, source, text, 'DASH')
        void which
      } else if (SPACED_HYPHEN_RE.test(text) && looksLikeProse(text)) {
        report(node, source, text, 'DASH')
      } else if (HYPHEN_RE.test(text) && looksLikeProse(text)) {
        const compounds = text.match(/[\p{L}\d]+(?:-[\p{L}\d]+)+/gu) ?? []
        const bad = compounds.filter((c) => !LEGITIMATE_COMPOUNDS[c.toLowerCase()])
        if (bad.length) report(node, source, text, 'HYPHEN')
      }
      for (const p of AI_PATTERNS) {
        if (p.re.test(text) && looksLikeProse(text)) {
          report(node, source, text, `AI:${p.id}`)
        }
      }
    }
  }

  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return

    switch (node.type) {
      case 'StringLiteral':
      case 'TemplateLiteral': {
        // A dash in any first party string literal is a defect, whatever the
        // string's role. The context specific cases below only recognise JSX,
        // copy keys and bare toast() calls, so a message shown through
        // toast.show() or held in a module constant escaped the rule and
        // shipped. Reporting on the literal itself closes that gap; `report`
        // dedupes against the cases below.
        //
        // Four positions are genuinely not copy and are skipped:
        //   - an injected CSS or source-text block (styling, not words)
        //   - a dash translation table key (the '-'/'–'/'—' map for thermal print)
        //   - a lone mathematical minus in a number formatter
        //   - developer channels, new Error(...) and console.*, which are not
        //     shipped to a person
        const CODE_BLOCK = /^\s*(?:\/\*|@(?:keyframes|media)|:root|html\s*\{|[.#][\w-]+\s*\{)/m
        const isMapKey = parent?.type === 'ObjectProperty' && parent.key === node
        const isDevChannel = isDeveloperChannel(parent)
        if (!isMapKey && !isDevChannel) {
          for (const frag of literalFragments(node)) {
            const text = frag.text
            if (!DASH_RE.test(text)) continue
            if (CODE_BLOCK.test(text)) continue
            if (/^\s*\u2212\s*$/.test(text)) continue
            report(node, `${key || 'literal'}:literal`, text, 'DASH')
          }
        }
        break
      }

      case 'JSXText':
        // Visible text between tags. Strip expressions that are pure whitespace.
        if (node.value.trim()) inspect(node, 'jsx-text')
        break

      case 'JSXAttribute': {
        const name = node.name?.name
        if (typeof name === 'string' && COPY_ATTRS.has(name) && node.value) {
          inspect(node.value, `attr:${name}`)
        }
        break
      }

      case 'ObjectProperty': {
        const name = node.key?.name ?? node.key?.value
        if (typeof name === 'string' && !NON_COPY_KEYS.has(name) && COPY_KEYS.has(name) && node.value) {
          inspect(node.value, `key:${name}`)
        } else if (typeof name === 'string' && !NON_COPY_KEYS.has(name) && node.value &&
                   (node.value.type === 'StringLiteral' || node.value.type === 'TemplateLiteral')) {
          // Unknown key holding a quoted string. Inspect it, but only if it
          // reads as prose; the classifier drops tokens and machine strings.
          const frag = literalFragments(node.value)[0]
          if (frag && looksLikeProse(frag.text)) inspect(node.value, `key:${name}`)
        }
        break
      }

      case 'VariableDeclarator': {
        // A module level constant such as
        //   export const CAPABILITY_NOTE = 'prose that a component renders'
        // is copy even though it is not written inside JSX. Without this case
        // a dash in such a constant is invisible to the audit while still
        // reaching the page, which is exactly how one shipped.
        if (node.init && (node.init.type === 'StringLiteral' || node.init.type === 'TemplateLiteral')) {
          const frag = literalFragments(node.init)
          if (frag.some((f) => looksLikeProse(f.text))) inspect(node.init, 'const')
        }
        break
      }

      case 'CallExpression': {
        // setToast({ message: '...' }) / toast('...') / alert('...')
        const callee = node.callee?.name
        if (typeof callee === 'string' && /^(toast|showToast|notify|setError|setSuccess|alert|confirm|setMessage|setStatus|swal)$/i.test(callee)) {
          for (const a of node.arguments) inspect(a, `call:${callee}`)
        }
        break
      }

      default:
        break
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue
      const child = node[k]
      if (Array.isArray(child)) for (const c of child) visit(c, node, k)
      else if (child && typeof child.type === 'string') visit(child, node, k)
    }
  }

  visit(ast.program, null, 'program')
  return findings
}

const files = SCAN_ROOTS.flatMap((r) => {
  const full = path.join(ROOT, r)
  if (!onlyApp || r.includes(onlyApp)) return walk(full)
  return []
})

const all = files.flatMap(auditFile)

const parseErrors = all.filter((f) => f.kind === 'PARSE_ERROR')
const dashes = all.filter((f) => f.kind === 'DASH')
const hyphens = all.filter((f) => f.kind === 'HYPHEN')
const ai = all.filter((f) => f.kind.startsWith('AI:'))

// ── output ───────────────────────────────────────────────────────────────────
const format = opt('format', 'text')

if (format === 'json') {
  console.log(JSON.stringify({ filesScanned: files.length, dashes, hyphens, ai, parseErrors }, null, 2))
} else {
  const byFile = (list) => {
    const m = new Map()
    for (const f of list) {
      if (!m.has(f.file)) m.set(f.file, [])
      m.get(f.file).push(f)
    }
    return m
  }

  console.log(`UI copy audit`)
  console.log(`  files scanned : ${files.length}`)
  console.log(`  parse errors  : ${parseErrors.length}`)
  console.log(`  DASH (must be 0) : ${dashes.length}`)
  console.log(`  HYPHEN (review)  : ${hyphens.length}`)
  console.log(`  AI patterns      : ${new Set(ai.map((f) => f.kind)).size} kinds, ${ai.length} hits`)
  console.log('')

  if (dashes.length) {
    console.log('── DASH in first party UI copy ─────────────────────────────────────')
    for (const [file, list] of byFile(dashes)) {
      console.log(`\n${file}`)
      for (const f of list) console.log(`  ${String(f.line).padStart(5)}  [${f.source}]  ${f.text}`)
    }
    console.log('')
  }

  if (hyphens.length && flag('hyphens')) {
    console.log('── HYPHENATED compounds to review ────────────────────────────────')
    for (const [file, list] of byFile(hyphens)) {
      console.log(`\n${file}`)
      for (const f of list) console.log(`  ${String(f.line).padStart(5)}  ${f.text}`)
    }
    console.log('')
  }

  if (ai.length && flag('ai')) {
    console.log('── AI sounding patterns ──────────────────────────────────────────')
    const grouped = new Map()
    for (const f of ai) {
      if (!grouped.has(f.kind)) grouped.set(f.kind, [])
      grouped.get(f.kind).push(f)
    }
    for (const [kind, list] of [...grouped].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n${kind}  (${list.length})`)
      for (const f of list.slice(0, 12)) console.log(`  ${f.file}:${f.line}  ${f.text.slice(0, 120)}`)
      if (list.length > 12) console.log(`  ... ${list.length - 12} more`)
    }
    console.log('')
  }

  if (parseErrors.length) {
    console.log('── PARSE ERRORS (fix these, the file was not audited) ────────────')
    for (const f of parseErrors) console.log(`  ${f.file}:${f.line}  ${f.text}`)
    console.log('')
  }
}

if (parseErrors.length) process.exit(2)
process.exit(dashes.length ? 1 : 0)
