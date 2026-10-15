// One definition of "a 6-digit code typed by a human" for every OTP/PIN box in both apps.
//
// Why strip-then-slice and NOT `maxLength`:
//   A browser applies `maxLength` to the RAW value before our onChange ever runs. Pasting
//   `123 456` (how mail clients and password managers usually render a code) would be
//   truncated to `123 45` first, leaving five digits and a permanently disabled submit
//   button. Stripping to digits first and slicing to six afterwards makes the paste land
//   whole as `123456`.
//
// Autofill reality check (do not promise more than this):
//   - `autocomplete="one-time-code"` is honoured for SMS/iMessage on iOS Safari and Android
//     Chrome. For an EMAIL-delivered code, support is partial and varies by mail client and
//     OS version. It is a best-effort hint, never a guarantee.
//   - The WebOTP API (`navigator.credentials.get({otp})`) is Chrome/Android only AND only
//     reads codes delivered by SMS. It cannot read an emailed code, so we deliberately do
//     not implement it here.
//   - A user-gesture-gated clipboard read is the mechanism that actually works for email
//     codes on every modern mobile browser, which is why `readClipboardOtp` exists.
//   Manual typing always remains available.

export const OTP_LENGTH = 6

/** Strip every non-digit, then keep at most `OTP_LENGTH`. `123 456` / `123-456` -> `123456`. */
export function cleanOtp(value) {
  return String(value == null ? '' : value).replace(/\D/g, '').slice(0, OTP_LENGTH)
}

/**
 * True only for exactly six digits — the shape the server will accept.
 * Tests the digit count WITHOUT truncating, so a seven-digit paste reports false rather than
 * silently passing as a complete code.
 */
export function isCompleteOtp(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '')
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(digits)
}

/**
 * Read a 6-digit code from the clipboard. MUST be called from a user gesture (a tap or a
 * keypress) because browsers gate `navigator.clipboard` behind both a secure context and
 * transient user activation.
 *
 * Returns the digits, or null when the clipboard is unavailable, the permission is refused,
 * the text holds no standalone 6-digit code, or the read throws. Never throws, never blocks.
 */
export async function readClipboardOtp(clipboard) {
  const api = clipboard || (typeof navigator !== 'undefined' ? navigator.clipboard : null)
  if (!api || typeof api.readText !== 'function') return null
  try {
    const text = String((await api.readText()) || '')
    const digits = cleanOtp(text)
    if (digits.length !== OTP_LENGTH) return null
    // Refuse when the clipboard holds a LONGER digit run than a bare code - an order number, a
    // phone number, a tracking id. Grouping is fine and expected: mail clients and password
    // managers render the code as `123 456`, which is still exactly six digits.
    const totalDigits = (text.match(/\d/g) || []).length
    return totalDigits === OTP_LENGTH ? digits : null
  } catch {
    return null
  }
}