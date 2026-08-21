// Pure, testable ESC/POS encoder for thermal receipt printers. Builds the raw
// command-byte stream sent straight over WebUSB by escposUsb.js — unlike the
// browser print path (receiptPrint.js), nothing here is rasterized, so the
// printer draws crisp vector text instead of a soft scaled image.
//
// Content parity contract: consumes the exact same
// `{ receipt, business, settings }` shape as buildReceiptHtml, so both paths
// always render the same business info, items, totals, payment block and
// footer from one source of truth.
import { computeTax, fmtReceiptDate } from './receiptPrint.js'

// Printable columns per roll width. A 58mm roll fits 32 columns of the
// printer's default 12×24 font; an 80mm roll fits 48. Mirrors the receipt_width
// setting already used by the HTML path's @page sizing.
const WIDTH_COLS = { '58': 32, '80': 48 }

// ESC/POS command sequences (byte values chosen per the Epson ESC/POS reference).
const CMD = {
  INIT: [0x1b, 0x40],               // ESC @  — reset to power-on state
  ALIGN_LEFT: [0x1b, 0x61, 0x00],   // ESC a 0
  BOLD_ON: [0x1b, 0x45, 0x01],      // ESC E 1
  BOLD_OFF: [0x1b, 0x45, 0x00],     // ESC E 0
  DOUBLE_ON: [0x1d, 0x21, 0x11],    // GS ! 17 — double width + height
  DOUBLE_OFF: [0x1d, 0x21, 0x00],   // GS ! 0
  FEED_CUT: [0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00], // 2 feeds + GS V B 0 partial cut
}

// Thermal firmware prints the legacy CP437 code page, which has no naira
// glyph and no typographic punctuation. Map the common offenders to their
// closest ASCII before encoding so receipts never show garbage bytes.
const CHAR_MAP = {
  '\u00a0': ' ',   // no-break space
  '\u2018': "'", '\u2019': "'",
  '\u201c': '"', '\u201d': '"',
  '\u2013': '-', '\u2014': '-',
  '\u20a6': 'N',   // ₦ naira sign
}

// One char → its printable ASCII byte (or nothing for astral glyphs like
// emoji, which are decorative and would otherwise print as "? Amoxicillin").
function foldChar(ch) {
  const mapped = CHAR_MAP[ch]
  if (mapped) return mapped
  // Strip combining marks so accented Latin letters collapse to their base
  // (é → e). Anything still outside printable ASCII becomes '?' rather than
  // a mangled multi-byte sequence.
  const folded = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return /^[\x20-\x7e]$/.test(folded) ? folded : '?'
}

function encodeText(value) {
  const out = []
  for (const ch of String(value ?? '')) {
    const cp = ch.codePointAt(0)
    if (cp > 0xffff) continue
    for (const f of foldChar(ch)) out.push(f.charCodeAt(0))
  }
  return out
}

// Greedy word-wrap; words longer than the budget are hard-split so no line
// ever exceeds the physical paper width.
function wrapText(value, cols) {
  const words = String(value ?? '').split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines = []
  let cur = ''
  for (let w of words) {
    while (w.length > cols) {
      if (cur) { lines.push(cur); cur = '' }
      lines.push(w.slice(0, cols))
      w = w.slice(cols)
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= cols) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines
}

// "Label ......... Value" row with the value flush-right. Overlong labels wrap
// onto full-width continuation lines so the value never collides.
function twoCol(left, right, cols) {
  const l = String(left)
  const r = String(right)
  const avail = Math.max(1, cols - r.length - 1)
  if (l.length <= avail) {
    return [l + ' '.repeat(cols - l.length - r.length) + r]
  }
  const lines = wrapText(l, avail)
  const last = lines.pop()
  return [...lines, last + ' '.repeat(Math.max(1, cols - last.length - r.length)) + r]
}

const centerPad = (value, cols) => {
  const v = String(value)
  const pad = Math.max(0, Math.floor((cols - v.length) / 2))
  return ' '.repeat(pad) + v
}

// CP437-safe amount: same digits/thousands separators as fmt(), but an ASCII
// "N" prefix instead of ₦, which the printer cannot render.
const money = (n) => 'N' + Number(n || 0).toLocaleString('en-US')

export function buildReceiptEscpos({ receipt = {}, business = {}, settings = {} }) {
  const r = receipt
  const biz = business
  const s = settings
  const cols = WIDTH_COLS[s.receipt_width === '58' ? '58' : '80'] || WIDTH_COLS['80']
  const items = Array.isArray(r.items) ? r.items : []
  const tax = computeTax(r.total, s.tax_rate)
  const date = fmtReceiptDate(r.date)
  const rate = Number(s.tax_rate) || 0
  const total = Number(r.total) || 0

  const bytes = []
  const cmd = (...seqs) => { for (const seq of seqs) bytes.push(...seq) }
  const line = (t) => { bytes.push(...encodeText(t)); bytes.push(0x0a) }
  const blank = () => bytes.push(0x0a)
  const sep = () => line('-'.repeat(cols))
  const centered = (t) => line(centerPad(t, cols))

  // Alignment stays LEFT for the whole receipt; centered lines are padded
  // manually instead — identical output across firmwares and exactly what
  // the unit tests assert on.
  cmd(CMD.INIT, CMD.ALIGN_LEFT)

  // Header — business identity, centered. Double-size lettering only fits when
  // the name is short enough for the physical column budget; long names fall
  // back to bold-at-normal-size instead of overflowing the roll.
  const name = String(biz?.name || '')
  if (name.length * 2 <= cols) {
    cmd(CMD.DOUBLE_ON, CMD.BOLD_ON)
    line(name)
    cmd(CMD.DOUBLE_OFF, CMD.BOLD_OFF)
  } else {
    cmd(CMD.BOLD_ON)
    wrapText(name, cols).forEach(line)
    cmd(CMD.BOLD_OFF)
  }
  if (biz?.address) centered(biz.address)
  if (biz?.phone) centered(biz.phone)
  if (biz?.whatsapp) centered('WhatsApp: ' + biz.whatsapp)
  if (s.receipt_header) centered(s.receipt_header)

  sep()
  twoCol('Receipt:', r.id, cols).forEach(line)
  twoCol('Date:', date, cols).forEach(line)
  twoCol('Client:', r.client, cols).forEach(line)
  sep()

  for (const i of items) {
    // The HTML path prefixes an emoji when set; thermal firmware has no glyph
    // for it, so the encoder drops it instead of printing "?" placeholders.
    const label = String(i.name ?? '')
    cmd(CMD.BOLD_ON)
    wrapText(label, cols).forEach(line)
    cmd(CMD.BOLD_OFF)
    twoCol(String(i.qty) + ' x ' + money(i.price), money(i.price * i.qty), cols).forEach(line)
    blank()
  }
  sep()

  twoCol('Subtotal', money(r.subtotal), cols).forEach(line)
  if (Number(r.disc) > 0) twoCol('Discount', '-' + money(r.disc), cols).forEach(line)
  cmd(CMD.BOLD_ON)
  twoCol('TOTAL', money(r.total), cols).forEach(line)
  cmd(CMD.BOLD_OFF)
  if (tax > 0) {
    twoCol('Tax (' + rate + '%)', money(tax), cols).forEach(line)
    twoCol('Total incl. tax', money(total + tax), cols).forEach(line)
  }
  twoCol('Payment', r.method, cols).forEach(line)
  if (r.method === 'Cash' && Number(r.cashGiven) > 0) {
    twoCol('Cash Given', money(r.cashGiven), cols).forEach(line)
    twoCol('Change', money(Number(r.cashGiven) - total), cols).forEach(line)
  } else if (r.method === 'Credit') {
    twoCol('Amount Paid', money(r.amtPaid), cols).forEach(line)
    twoCol('Balance Owed', money(r.balance), cols).forEach(line)
  }
  if (r.splitAmounts) {
    const split = Object.entries(r.splitAmounts)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([k, v]) => k + ': ' + money(parseFloat(v)))
      .join(' | ')
    if (split) wrapText(split, cols).forEach(line)
  }
  sep()

  if (s.refund_policy) { wrapText(s.refund_policy, cols).forEach(centered); sep() }
  wrapText(s.receipt_footer || 'Thank you for your patronage!', cols).forEach(centered)

  cmd(CMD.FEED_CUT)
  return new Uint8Array(bytes)
}
