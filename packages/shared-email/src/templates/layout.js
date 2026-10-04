// The one layout every transactional email is built from, for both apps.
//
// Email clients are not browsers: Outlook renders with Word, Gmail strips <style> in some views and shows no SVG, and
// many clients block images until the reader allows them. So the structure is nested tables with inline styles, the
// logo is a small PNG with the name beside it as real text (the brand still shows when images are blocked), and the
// button is a padded link rather than an image.

// ── Escaping ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function esc(value) {
  return (value == null ? '' : String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

class SafeHtml {
  constructor(value) { this.value = value }
  toString() { return this.value }
}

function render(value) {
  if (value instanceof SafeHtml) return value.value
  if (Array.isArray(value)) return value.map(render).join('')
  if (value == null || value === false) return ''
  return esc(value)
}

// html`<p>Hi ${name}</p>`: every interpolated value is escaped unless it is itself html`...` (or an array of them), so
// a template cannot forget to escape a field.
export function html(strings, ...values) {
  return new SafeHtml(strings.reduce((out, part, i) => out + part + (i < values.length ? render(values[i]) : ''), ''))
}

// Only links a reader can safely follow. Anything else (javascript:, data:, a bare string) becomes '#'.
export function safeUrl(url) {
  const value = String(url ?? '').trim()
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : '#'
}

// ── Brands ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const env = (name) => (typeof process !== 'undefined' && process.env?.[name]) || ''

const GREEN = '#0E6F5A'
const INK = '#0f172a'
const TEXT = '#334155'
const MUTED = '#64748b'
const RULE = '#e2e8f0'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

// logoUrl is always the production site: an email is opened long after it was sent and from anywhere, so the image
// must not depend on which deployment sent it. The files are apps/<app>/public/email-logo.png, 112px high and shown at
// 40px so they stay sharp on high-density screens.
export const BRANDS = {
  carefind: {
    name: 'CareFind',
    nameParts: ['Care', 'Find'],
    logoUrl: 'https://carefind.app/email-logo.png',
    logoWidth: 35,
    domain: 'carefind.app',
    support: 'support@mail.carefind.app',
    get siteUrl() { return (env('CAREFIND_APP_URL') || env('APP_URL') || 'https://carefind.app').replace(/\/+$/, '') },
  },
  carehub: {
    name: 'CareHub',
    nameParts: ['Care', 'Hub'],
    logoUrl: 'https://carefindhub.com/email-logo.png',
    logoWidth: 41,
    domain: 'carefindhub.com',
    support: 'support@mail.carefindhub.com',
    get siteUrl() { return (env('CAREHUB_APP_URL') || env('APP_URL') || 'https://carefindhub.com').replace(/\/+$/, '') },
  },
}

export const brandFor = (app) => BRANDS[app] || BRANDS.carefind
export const siteLink = (app, path = '') => `${brandFor(app).siteUrl}${path}`

// ── Building blocks ──────────────────────────────────────────────────────────────────────────────────────────────────
export function paragraph(content) {
  return html`<p class="em-text" style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${TEXT}">${content}</p>`
}

export function smallPrint(content) {
  return html`<p class="em-muted" style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${MUTED}">${content}</p>`
}

// rows: [label, value]. A row with no value is left out rather than shown as a dash.
export function detailsTable(rows) {
  const shown = rows.filter(([, value]) => value != null && value !== '' && value !== false)
  if (shown.length === 0) return html``
  return html`<table role="presentation" class="em-panel" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f8fafc;border:1px solid ${RULE};border-radius:10px"><tr><td style="padding:6px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${shown.map(([label, value], i) => html`<tr><td class="em-muted em-rule" valign="top" width="38%" style="padding:11px 12px 11px 0;font-size:13px;line-height:1.5;color:${MUTED};${i ? `border-top:1px solid ${RULE}` : ''}">${label}</td><td class="em-strong em-rule" valign="top" style="padding:11px 0;font-size:14px;line-height:1.5;font-weight:600;color:${INK};word-break:break-word;${i ? `border-top:1px solid ${RULE}` : ''}">${value}</td></tr>`)}</table></td></tr></table>`
}

const TONES = {
  info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
  success: { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46' },
  warn: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
  danger: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
}

export function notice(tone, content) {
  const name = TONES[tone] ? tone : 'info'
  const t = TONES[name]
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td class="em-n-${name}" style="padding:14px 16px;background:${t.bg};border:1px solid ${t.border};border-left:4px solid ${t.text};border-radius:8px;font-size:14px;line-height:1.6;color:${t.text}">${content}</td></tr></table>`
}

const naira = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? `₦${n.toLocaleString('en-NG')}` : ''
}

// items: [{ name, quantity, price }] with price in naira. total is shown as given, so the caller's figure (which
// includes delivery and fees) is never replaced by a sum worked out here.
export function itemsTable(items, { totalLabel = 'Total', total } = {}) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0 && (total == null || total === '')) return html``
  const cell = `padding:11px 0;font-size:14px;line-height:1.5;border-top:1px solid ${RULE}`
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${list.length ? html`<tr><td class="em-muted" style="padding:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">Item</td><td class="em-muted" align="center" width="48" style="padding:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">Qty</td><td class="em-muted" align="right" width="96" style="padding:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">Amount</td></tr>` : ''}${list.map((item) => html`<tr><td class="em-text em-rule" style="${cell};color:${TEXT};word-break:break-word">${item?.name}</td><td class="em-text em-rule" align="center" style="${cell};color:${TEXT}">${item?.quantity}</td><td class="em-strong em-rule" align="right" style="${cell};color:${INK};white-space:nowrap">${naira(Number(item?.price) * Number(item?.quantity))}</td></tr>`)}${total == null || total === '' ? '' : html`<tr><td class="em-strong em-rule" colspan="2" style="padding:14px 0 0;font-size:15px;font-weight:700;color:${INK};border-top:2px solid ${INK}">${totalLabel}</td><td class="em-strong em-rule" align="right" style="padding:14px 0 0;font-size:16px;font-weight:800;color:${INK};white-space:nowrap;border-top:2px solid ${INK}">${typeof total === 'number' ? naira(total) : total}</td></tr>`}</table>`
}

// A padded link. The conditional comments give Outlook (which ignores padding on a link) the same height and width.
function button({ href, label }) {
  return html`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td align="center" bgcolor="${GREEN}" style="border-radius:8px;background:${GREEN}"><a href="${safeUrl(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${new SafeHtml(FONT)};font-size:15px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;mso-padding-alt:0"><!--[if mso]><i style="mso-font-width:300%;mso-text-raise:21pt" hidden>&emsp;</i><span style="mso-text-raise:10pt"><![endif]-->${label}<!--[if mso]></span><i style="mso-font-width:300%" hidden>&emsp;&#8203;</i><![endif]--></a></td></tr></table>`
}

function header(brand) {
  return html`<a href="${safeUrl(brand.siteUrl)}" target="_blank" style="text-decoration:none"><table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding-right:10px"><img src="${brand.logoUrl}" width="${brand.logoWidth}" height="40" alt="" style="display:block;width:${brand.logoWidth}px;height:40px;border:0;outline:none;text-decoration:none"></td><td class="em-strong" valign="middle" style="font-family:${new SafeHtml(FONT)};font-size:24px;line-height:1;font-weight:800;letter-spacing:-0.4px;color:${INK}">${brand.nameParts[0]}<span class="em-accent" style="color:${GREEN}">${brand.nameParts[1]}</span></td></tr></table></a>`
}

function footer(brand, reason) {
  return html`<p class="em-muted" style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${MUTED}">${reason || `You are receiving this email because of activity on your ${brand.name} account.`}</p><p class="em-muted" style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${MUTED}">Need help? Contact <a class="em-accent" href="mailto:${brand.support}" style="color:${GREEN};text-decoration:underline">${brand.support}</a></p><p class="em-muted" style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">© ${new Date().getFullYear()} ${brand.name}. All rights reserved. · <a href="${safeUrl(brand.siteUrl)}" style="color:#94a3b8;text-decoration:underline">${brand.domain}</a></p>`
}

// Apple Mail and some others honour these; Gmail ignores <style> in places, which is why every colour is also inline.
const STYLE = `
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic}
@media (max-width:620px){.em-wrap{width:100%!important}.em-pad{padding:28px 22px!important}.em-title{font-size:22px!important}}
@media (prefers-color-scheme:dark){
.em-bg{background:#0b1210!important}.em-card{background:#111a17!important;border-color:#22302b!important;border-top-color:#34b894!important}
.em-accent{color:#34b894!important}
.em-n-info{background:#10203a!important;border-color:#1e3a5f!important;border-left-color:#60a5fa!important;color:#bfdbfe!important}
.em-n-success{background:#0d2a21!important;border-color:#14493a!important;border-left-color:#34d399!important;color:#a7f3d0!important}
.em-n-warn{background:#2b2110!important;border-color:#4d3a12!important;border-left-color:#fbbf24!important;color:#fde68a!important}
.em-n-danger{background:#2d1414!important;border-color:#5a1f1f!important;border-left-color:#f87171!important;color:#fecaca!important}
.em-title,.em-strong{color:#f1f5f9!important}.em-text{color:#cbd5e1!important}.em-muted{color:#94a3b8!important}
.em-panel{background:#16211d!important;border-color:#22302b!important}.em-rule{border-color:#22302b!important}
}`.replace(/\n/g, '')

/**
 * @param {object} options
 * @param {'carefind'|'carehub'} options.app
 * @param {string} options.title       the one heading
 * @param {string} [options.preheader] the line an inbox shows after the subject
 * @param {*} options.body             html`...` (or an array of them)
 * @param {{href: string, label: string}} [options.cta]
 * @param {boolean} [options.showLink] print the cta address under the button, for readers whose button does not work
 * @param {string} [options.reason]    why the reader got this email (footer)
 * @returns {string}
 */
export function layout({ app, title, preheader, body, cta, showLink = false, reason }) {
  const brand = brandFor(app)
  const font = new SafeHtml(FONT)
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><!--[if mso]><xml><o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office"><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--><style>${new SafeHtml(STYLE)}</style></head><body class="em-bg" style="margin:0;padding:0;background:#f1f5f4;font-family:${font}">${preheader ? html`<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f4">${preheader}</div>` : ''}<table role="presentation" class="em-bg" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f4"><tr><td align="center" style="padding:32px 12px"><table role="presentation" class="em-wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;font-family:${font}"><tr><td align="center" style="padding:0 0 24px">${header(brand)}</td></tr><tr><td class="em-card em-pad" style="padding:36px 40px;background:#ffffff;border:1px solid ${RULE};border-top:4px solid ${GREEN};border-radius:12px"><h1 class="em-title" style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:800;letter-spacing:-0.3px;color:${INK}">${title}</h1>${body}${cta ? button(cta) : ''}${cta && showLink ? html`<p class="em-muted" style="margin:0;font-size:13px;line-height:1.6;color:${MUTED}">If the button does not work, copy this link into your browser:<br><span class="em-accent" style="color:${GREEN};word-break:break-all">${safeUrl(cta.href)}</span></p>` : ''}</td></tr><tr><td align="center" style="padding:24px 24px 0;text-align:center">${footer(brand, reason)}</td></tr></table></td></tr></table></body></html>`.toString()
}
