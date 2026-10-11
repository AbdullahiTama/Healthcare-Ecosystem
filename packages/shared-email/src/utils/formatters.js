export function fmtNaira(naira) { return '\u20A6' + Number(naira).toLocaleString('en-NG', { minimumFractionDigits: 0 }) }
export function fmtKobo(kobo) { return '\u20A6' + (Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 0 }) }
export function fmtDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' }) }
export function fmtPhone(phone) { if (!phone) return '—'; const n = String(phone).replace(/\D/g, ''); if (n.startsWith('0')) return '234' + n.slice(1); if (!n.startsWith('234')) return '234' + n; return phone }
// A bank account number as it may appear in an email: the last four digits and nothing else. Idempotent (an already masked
// value stays the same) and total: a full number, a masked number, undefined and junk all give a safe string.
export function maskAccount(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : '••••'
}
export function fmtNGN(naira) { return '\u20A6' + Number(naira).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
