import { describe, it, expect } from 'vitest'
import { createKeyboardScanDetector, SCAN_MAX_GAP_MS } from './barcodeScanner'

// Feeds `text` one key every `gap` ms from `t0`, then `suffix` (if any) one gap
// later. Returns every non-null result and the time after the last key.
function feed(detector, text, { gap = 5, t0 = 1000, suffix = 'Enter', extra = {} } = {}) {
  const results = []
  let t = t0
  for (const key of text) {
    const r = detector.keydown({ key, ...extra }, t)
    if (r) results.push(r)
    t += gap
  }
  if (suffix) {
    const r = detector.keydown({ key: suffix }, t)
    if (r) results.push(r)
  }
  return { results, t }
}

describe('createKeyboardScanDetector', () => {
  it('reads a fast burst ended by Enter as a scan', () => {
    const { results } = feed(createKeyboardScanDetector(), '8901234567890')
    expect(results).toEqual([{ type: 'start' }, { type: 'scan', code: '8901234567890' }])
  })

  it('accepts Tab as the end of a scan too', () => {
    const { results } = feed(createKeyboardScanDetector(), '6151100001', { suffix: 'Tab' })
    expect(results.at(-1)).toEqual({ type: 'scan', code: '6151100001' })
  })

  it('never treats typing at human speed as a scan', () => {
    const { results } = feed(createKeyboardScanDetector(), '8901234567890', { gap: 120 })
    expect(results.some(r => r.type === 'scan')).toBe(false)
    // Every slow key starts its own burst.
    expect(results.filter(r => r.type === 'start')).toHaveLength(13)
  })

  it('needs at least six characters: a quick "12" + Enter in Quantity is not a scan', () => {
    const { results } = feed(createKeyboardScanDetector(), '12', { gap: 10 })
    expect(results.some(r => r.type === 'scan')).toBe(false)
  })

  it('ignores Shift (scanners press it before capital letters)', () => {
    const d = createKeyboardScanDetector()
    let t = 0
    const out = []
    for (const key of ['Shift', 'A', 'B', 'Shift', 'C', '1', '2', '3', 'Enter']) { out.push(d.keydown({ key }, t)); t += 4 }
    expect(out.filter(Boolean).at(-1)).toEqual({ type: 'scan', code: 'ABC123' })
  })

  it('never treats a held key (auto-repeat) or a shortcut as a scan', () => {
    expect(feed(createKeyboardScanDetector(), '00000000', { extra: { repeat: true } }).results).toEqual([])
    expect(feed(createKeyboardScanDetector(), 'vvvvvvvv', { extra: { ctrlKey: true } }).results).toEqual([])
  })

  it('an Enter that comes long after the burst is a normal Enter', () => {
    const d = createKeyboardScanDetector()
    const { t } = feed(d, '8901234567890', { suffix: null })
    expect(d.keydown({ key: 'Enter' }, t + SCAN_MAX_GAP_MS + 200)).toBeNull()
  })

  it('a pause restarts the burst, so a typed prefix is not glued to a later scan', () => {
    const d = createKeyboardScanDetector()
    const first = feed(d, '12', { gap: 5, suffix: null })
    const { results } = feed(d, '8901234567890', { t0: first.t + 500 })
    expect(results.at(-1)).toEqual({ type: 'scan', code: '8901234567890' })
  })

  it('a scan with no suffix is reported once the keys stop', () => {
    const d = createKeyboardScanDetector()
    feed(d, '8901234567890', { suffix: null })
    expect(d.pending()).toBe(true)
    expect(d.idle()).toBe('8901234567890')
    expect(d.pending()).toBe(false)
    expect(d.idle()).toBeNull()
  })

  it('a short fast burst is not pending and goes nowhere when idle', () => {
    const d = createKeyboardScanDetector()
    feed(d, '123', { suffix: null })
    expect(d.pending()).toBe(false)
    expect(d.idle()).toBeNull()
  })
})
